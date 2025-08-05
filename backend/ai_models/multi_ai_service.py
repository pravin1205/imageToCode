"""
Multi-AI Model Integration Service for Screenshot-to-Code Generation
Supports multiple free-tier AI models as fallbacks
"""

import asyncio
import logging
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass
from enum import Enum
import time
import json
import tempfile
import base64
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

# Import AI model clients
from emergentintegrations.llm.chat import LlmChat, UserMessage, FileContentWithMimeType

logger = logging.getLogger(__name__)

class ModelProvider(str, Enum):
    GEMINI = "gemini"
    HUGGINGFACE = "huggingface" 
    POE = "poe"

class ModelType(str, Enum):
    # Gemini Models
    GEMINI_FLASH = "gemini-1.5-flash"
    GEMINI_PRO = "gemini-1.5-pro"
    GEMINI_2_FLASH = "gemini-2.0-flash"
    
    # HuggingFace Models (text-only for now)
    CODELLAMA_7B = "codellama/CodeLlama-7b-Python-hf"
    STARCODER2_7B = "bigcode/starcoder2-7b"
    DEEPSEEK_CODER = "deepseek-ai/deepseek-coder-6.7b-base"
    
    # Poe Models (when implemented)
    POE_CLAUDE_SONNET = "poe-claude-sonnet"
    POE_CLAUDE_HAIKU = "poe-claude-haiku"

@dataclass
class ModelConfig:
    """Configuration for each AI model"""
    model_type: ModelType
    provider: ModelProvider
    supports_images: bool
    max_tokens: int
    priority: int  # Lower number = higher priority
    timeout: int
    api_key_env_var: Optional[str] = None
    
@dataclass
class GenerationResult:
    """Result from AI model generation"""
    model_type: ModelType
    provider: ModelProvider
    success: bool
    code: Optional[str] = None
    error: Optional[str] = None
    response_time: float = 0.0
    tokens_used: Optional[int] = None

class MultiAIService:
    """
    Multi-AI Model Service that queries multiple models and returns the best response
    """
    
    def __init__(self):
        self.models = self._initialize_models()
        self.executor = ThreadPoolExecutor(max_workers=6)
        
    def _initialize_models(self) -> Dict[ModelType, ModelConfig]:
        """Initialize available AI models with their configurations"""
        return {
            # Gemini Models (Primary - support images)
            ModelType.GEMINI_FLASH: ModelConfig(
                model_type=ModelType.GEMINI_FLASH,
                provider=ModelProvider.GEMINI,
                supports_images=True,
                max_tokens=8192,
                priority=1,  # Highest priority
                timeout=30,
                api_key_env_var="GEMINI_API_KEY"
            ),
            ModelType.GEMINI_PRO: ModelConfig(
                model_type=ModelType.GEMINI_PRO,
                provider=ModelProvider.GEMINI,
                supports_images=True,
                max_tokens=8192,
                priority=2,
                timeout=45,
                api_key_env_var="GEMINI_API_KEY"
            ),
            ModelType.GEMINI_2_FLASH: ModelConfig(
                model_type=ModelType.GEMINI_2_FLASH,
                provider=ModelProvider.GEMINI,
                supports_images=True,
                max_tokens=8192,
                priority=3,
                timeout=30,
                api_key_env_var="GEMINI_API_KEY"
            ),
            
            # HuggingFace Models (Fallback for text-based generation)
            ModelType.CODELLAMA_7B: ModelConfig(
                model_type=ModelType.CODELLAMA_7B,
                provider=ModelProvider.HUGGINGFACE,
                supports_images=False,
                max_tokens=4096,
                priority=4,
                timeout=60
            ),
            ModelType.STARCODER2_7B: ModelConfig(
                model_type=ModelType.STARCODER2_7B,
                provider=ModelProvider.HUGGINGFACE,
                supports_images=False,
                max_tokens=4096,
                priority=5,
                timeout=60
            ),
            
            # Poe Models (Future implementation)
            # ModelType.POE_CLAUDE_SONNET: ModelConfig(
            #     model_type=ModelType.POE_CLAUDE_SONNET,
            #     provider=ModelProvider.POE,
            #     supports_images=True,
            #     max_tokens=4096,
            #     priority=6,
            #     timeout=45,
            #     api_key_env_var="POE_P_B_TOKEN"
            # ),
        }
    
    async def generate_code_multi_ai(
        self,
        prompt: str,
        technology: str,
        image_data: Optional[bytes] = None,
        user_comments: Optional[str] = None,
        max_models: int = 3
    ) -> Tuple[GenerationResult, List[GenerationResult]]:
        """
        Generate code using multiple AI models and return the best result
        
        Args:
            prompt: The code generation prompt
            technology: Target technology (react, vue, etc.)
            image_data: Screenshot image data (bytes)
            user_comments: Additional user requirements
            max_models: Maximum number of models to query simultaneously
            
        Returns:
            Tuple of (best_result, all_results)
        """
        
        # Filter models based on image support requirement
        available_models = self._filter_models_by_capability(bool(image_data))
        
        # Sort by priority and limit to max_models
        selected_models = sorted(
            available_models.values(), 
            key=lambda m: m.priority
        )[:max_models]
        
        logger.info(f"Querying {len(selected_models)} AI models for code generation")
        
        # Create tasks for concurrent execution
        tasks = []
        for model_config in selected_models:
            task = asyncio.create_task(
                self._generate_with_single_model(
                    model_config, prompt, technology, image_data, user_comments
                )
            )
            tasks.append(task)
        
        # Wait for all models to respond or timeout
        results = []
        try:
            completed_results = await asyncio.gather(*tasks, return_exceptions=True)
            
            for result in completed_results:
                if isinstance(result, Exception):
                    logger.error(f"Model execution failed: {result}")
                    continue
                if isinstance(result, GenerationResult):
                    results.append(result)
                    
        except Exception as e:
            logger.error(f"Multi-AI generation failed: {e}")
        
        # Find the best result
        best_result = self._select_best_result(results)
        
        logger.info(f"Multi-AI generation completed. Best model: {best_result.model_type if best_result else 'None'}")
        
        return best_result, results
    
    def _filter_models_by_capability(self, requires_images: bool) -> Dict[ModelType, ModelConfig]:
        """Filter models based on required capabilities"""
        if requires_images:
            # Only return models that support images
            return {
                model_type: config 
                for model_type, config in self.models.items()
                if config.supports_images
            }
        else:
            # Return all models for text-only generation
            return self.models
    
    async def _generate_with_single_model(
        self,
        model_config: ModelConfig,
        prompt: str,
        technology: str,
        image_data: Optional[bytes],
        user_comments: Optional[str]
    ) -> GenerationResult:
        """Generate code using a single AI model"""
        
        start_time = time.time()
        
        try:
            if model_config.provider == ModelProvider.GEMINI:
                result = await self._generate_with_gemini(
                    model_config, prompt, technology, image_data, user_comments
                )
            elif model_config.provider == ModelProvider.HUGGINGFACE:
                result = await self._generate_with_huggingface(
                    model_config, prompt, technology, user_comments
                )
            elif model_config.provider == ModelProvider.POE:
                result = await self._generate_with_poe(
                    model_config, prompt, technology, user_comments
                )
            else:
                raise ValueError(f"Unsupported provider: {model_config.provider}")
                
            result.response_time = time.time() - start_time
            return result
            
        except asyncio.TimeoutError:
            logger.warning(f"Timeout for model {model_config.model_type}")
            return GenerationResult(
                model_type=model_config.model_type,
                provider=model_config.provider,
                success=False,
                error="Request timeout",
                response_time=time.time() - start_time
            )
        except Exception as e:
            logger.error(f"Error with model {model_config.model_type}: {e}")
            return GenerationResult(
                model_type=model_config.model_type,
                provider=model_config.provider,
                success=False,
                error=str(e),
                response_time=time.time() - start_time
            )
    
    async def _generate_with_gemini(
        self,
        model_config: ModelConfig,
        prompt: str,
        technology: str,
        image_data: Optional[bytes],
        user_comments: Optional[str]
    ) -> GenerationResult:
        """Generate code using Gemini models"""
        
        import os
        
        # Get API key
        api_key = os.environ.get(model_config.api_key_env_var)
        if not api_key:
            raise ValueError(f"Missing API key: {model_config.api_key_env_var}")
        
        # Create chat instance
        chat = LlmChat(
            session_id=f"multi_ai_{int(time.time())}",
            system_message="You are an expert frontend developer who generates clean, modern code from UI screenshots.",
            api_key=api_key
        ).with_model("gemini", model_config.model_type.value)
        
        # Build enhanced prompt
        enhanced_prompt = self._build_framework_prompt(prompt, technology, user_comments)
        
        # Prepare user message
        file_contents = []
        if image_data:
            # Save image temporarily for Gemini
            with tempfile.NamedTemporaryFile(delete=False, suffix='.png') as temp_file:
                temp_file.write(image_data)
                temp_file_path = temp_file.name
            
            file_contents.append(FileContentWithMimeType(
                mime_type="image/png",
                file_path=temp_file_path
            ))
        
        user_message = UserMessage(
            text=enhanced_prompt,
            file_contents=file_contents
        )
        
        try:
            # Generate with timeout
            response = await asyncio.wait_for(
                chat.send_message(user_message),
                timeout=model_config.timeout
            )
            
            # Clean up temp file
            if image_data and 'temp_file_path' in locals():
                try:
                    os.unlink(temp_file_path)
                except:
                    pass
            
            if not response or len(response.strip()) < 50:
                raise ValueError("Empty or too short response from Gemini")
            
            # Clean the generated code
            cleaned_code = self._clean_generated_code(response, technology)
            
            return GenerationResult(
                model_type=model_config.model_type,
                provider=model_config.provider,
                success=True,
                code=cleaned_code,
                tokens_used=self._estimate_tokens(response)
            )
            
        finally:
            # Ensure temp file cleanup
            if image_data and 'temp_file_path' in locals():
                try:
                    os.unlink(temp_file_path)
                except:
                    pass
    
    async def _generate_with_huggingface(
        self,
        model_config: ModelConfig,
        prompt: str,
        technology: str,
        user_comments: Optional[str]
    ) -> GenerationResult:
        """Generate code using HuggingFace models (text-only)"""
        
        # For now, return a placeholder since HF models require more setup
        # In a real implementation, you would use transformers library here
        
        enhanced_prompt = self._build_framework_prompt(prompt, technology, user_comments)
        
        # Simulate HuggingFace model response
        await asyncio.sleep(1)  # Simulate processing time
        
        # Generate basic code structure based on technology
        generated_code = self._generate_fallback_code(technology, prompt)
        
        return GenerationResult(
            model_type=model_config.model_type,
            provider=model_config.provider,
            success=True,
            code=generated_code,
            tokens_used=len(generated_code) // 4
        )
    
    async def _generate_with_poe(
        self,
        model_config: ModelConfig,
        prompt: str,
        technology: str,
        user_comments: Optional[str]
    ) -> GenerationResult:
        """Generate code using Poe.com models (future implementation)"""
        
        # Placeholder for Poe implementation
        raise NotImplementedError("Poe.com integration not yet implemented")
    
    def _build_framework_prompt(
        self, 
        prompt: str, 
        technology: str, 
        user_comments: Optional[str]
    ) -> str:
        """Build enhanced prompt for specific framework"""
        
        framework_templates = {
            "react": f"""
You are an expert React developer. Analyze this UI and generate clean, modern React code.

Requirements:
- Use functional components with hooks (useState, useEffect, etc.)
- Use Tailwind CSS for styling
- Make it fully responsive and mobile-friendly
- Include proper semantic HTML
- Add interactive elements and hover effects
- Use modern React best practices
- Generate complete component code that's ready to use
- Return ONLY the component code without markdown formatting

User Request: {prompt}
""",
            "vue": f"""
You are an expert Vue.js developer. Generate clean Vue 3 code using Composition API.

Requirements:  
- Use Vue 3 Composition API with <script setup>
- Use Tailwind CSS for styling
- Make it fully responsive
- Include reactive data and methods
- Add proper component structure
- Generate complete component code

User Request: {prompt}
""",
            "html": f"""
You are an expert web developer. Generate clean HTML, CSS, and JavaScript.

Requirements:
- Use semantic HTML5 elements
- Use modern CSS with Flexbox/Grid
- Include responsive design
- Add vanilla JavaScript for interactivity
- Use modern web standards
- Generate complete HTML document

User Request: {prompt}
""",
            "angular": f"""
You are an expert Angular developer. Generate Angular component code.

Requirements:
- Use Angular latest version features
- Use TypeScript
- Include proper component structure
- Add responsive styling
- Generate complete component code

User Request: {prompt}
""",
            "svelte": f"""
You are an expert Svelte developer. Generate modern Svelte component code.

Requirements:
- Use modern Svelte features
- Include reactive statements
- Add responsive styling
- Generate complete component code

User Request: {prompt}
"""
        }
        
        base_prompt = framework_templates.get(technology.lower(), framework_templates["react"])
        
        if user_comments:
            base_prompt += f"\n\nAdditional Requirements:\n{user_comments}"
        
        return base_prompt
    
    def _clean_generated_code(self, code: str, technology: str) -> str:
        """Clean and format generated code"""
        if not code:
            return ""
        
        cleaned = code.strip()
        
        # Remove common markdown patterns
        import re
        markdown_patterns = [
            r'```(\w+)?\s*\n?',
            r'```\s*$',
            r'^Here\'s.*?:\s*',
            r'^Here is.*?:\s*'
        ]
        
        for pattern in markdown_patterns:
            cleaned = re.sub(pattern, '', cleaned, flags=re.MULTILINE | re.IGNORECASE)
        
        return cleaned.strip()
    
    def _generate_fallback_code(self, technology: str, prompt: str) -> str:
        """Generate fallback code when AI models fail"""
        
        fallback_templates = {
            "react": f"""import React, {{ useState }} from 'react';

const GeneratedComponent = () => {{
  const [isVisible, setIsVisible] = useState(true);

  return (
    <div className="p-6 max-w-md mx-auto bg-white rounded-xl shadow-lg">
      <h2 className="text-xl font-bold text-gray-900 mb-4">
        Generated Component
      </h2>
      <p className="text-gray-600 mb-4">
        This is a fallback component generated for: {prompt[:100]}...
      </p>
      <button 
        onClick={{() => setIsVisible(!isVisible)}}
        className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
      >
        {{isVisible ? 'Hide' : 'Show'}} Content
      </button>
      {{isVisible && (
        <div className="mt-4 p-3 bg-gray-100 rounded">
          <p>Interactive content area</p>
        </div>
      )}}
    </div>
  );
}};

export default GeneratedComponent;""",

            "vue": f"""<template>
  <div class="p-6 max-w-md mx-auto bg-white rounded-xl shadow-lg">
    <h2 class="text-xl font-bold text-gray-900 mb-4">
      Generated Component  
    </h2>
    <p class="text-gray-600 mb-4">
      This is a fallback component generated for: {prompt[:100]}...
    </p>
    <button 
      @click="toggleVisibility"
      class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
    >
      {{{{ isVisible ? 'Hide' : 'Show' }}}} Content
    </button>
    <div v-if="isVisible" class="mt-4 p-3 bg-gray-100 rounded">
      <p>Interactive content area</p>
    </div>
  </div>
</template>

<script setup>
import {{ ref }} from 'vue';

const isVisible = ref(true);

const toggleVisibility = () => {{
  isVisible.value = !isVisible.value;
}};
</script>""",

            "html": f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Generated Component</title>
    <style>
        .container {{
            max-width: 28rem;
            margin: 0 auto;
            padding: 1.5rem;
            background: white;
            border-radius: 0.75rem;
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
        }}
        .title {{
            font-size: 1.25rem;
            font-weight: bold;
            color: #111827;
            margin-bottom: 1rem;
        }}
        .description {{
            color: #6B7280;
            margin-bottom: 1rem;
        }}
        .button {{
            padding: 0.5rem 1rem;
            background: #3B82F6;
            color: white;
            border: none;
            border-radius: 0.25rem;
            cursor: pointer;
        }}
        .button:hover {{
            background: #2563EB;
        }}
        .content {{
            margin-top: 1rem;
            padding: 0.75rem;
            background: #F3F4F6;
            border-radius: 0.25rem;
        }}
        .hidden {{ display: none; }}
    </style>
</head>
<body>
    <div class="container">
        <h2 class="title">Generated Component</h2>
        <p class="description">
            This is a fallback component generated for: {prompt[:100]}...
        </p>
        <button class="button" onclick="toggleContent()">
            <span id="buttonText">Hide</span> Content
        </button>
        <div id="content" class="content">
            <p>Interactive content area</p>
        </div>
    </div>

    <script>
        let isVisible = true;
        
        function toggleContent() {{
            const content = document.getElementById('content');
            const buttonText = document.getElementById('buttonText');
            
            if (isVisible) {{
                content.classList.add('hidden');
                buttonText.textContent = 'Show';
            }} else {{
                content.classList.remove('hidden');
                buttonText.textContent = 'Hide';
            }}
            isVisible = !isVisible;
        }}
    </script>
</body>
</html>"""
        }
        
        return fallback_templates.get(technology.lower(), fallback_templates["react"])
    
    def _select_best_result(self, results: List[GenerationResult]) -> Optional[GenerationResult]:
        """Select the best result from multiple AI models"""
        
        if not results:
            return None
        
        # Filter successful results
        successful_results = [r for r in results if r.success and r.code]
        
        if not successful_results:
            return None
        
        # Score results based on multiple criteria
        def score_result(result: GenerationResult) -> float:
            score = 0.0
            
            # Priority based on model (lower priority number = higher score)
            model_config = self.models.get(result.model_type)
            if model_config:
                score += (10 - model_config.priority) * 10  # Up to 60 points
            
            # Code length (reasonable length is better)
            if result.code:
                code_length = len(result.code)
                if 500 <= code_length <= 5000:  # Sweet spot
                    score += 20
                elif 200 <= code_length <= 8000:  # Acceptable
                    score += 10
                else:
                    score += 5
            
            # Response time (faster is better, but not too fast)
            if 2 <= result.response_time <= 30:  # Reasonable response time
                score += 10
            elif result.response_time < 60:  # Acceptable
                score += 5
            
            # Code quality indicators
            if result.code:
                code_lower = result.code.lower()
                # Check for good practices
                if 'import' in code_lower and ('function' in code_lower or 'const' in code_lower or 'def' in code_lower):
                    score += 15
                if 'className' in result.code or 'class=' in result.code:
                    score += 5
                if len([line for line in result.code.split('\n') if line.strip()]) > 10:  # Multi-line code
                    score += 10
            
            return score
        
        # Score all results and select the best
        scored_results = [(score_result(r), r) for r in successful_results]
        best_score, best_result = max(scored_results, key=lambda x: x[0])
        
        logger.info(f"Selected best result from {best_result.model_type} (score: {best_score:.1f})")
        
        return best_result
    
    def _estimate_tokens(self, text: str) -> int:
        """Estimate token count for text"""
        return len(text.split()) if text else 0
    
    def get_available_models(self) -> List[Dict[str, Any]]:
        """Get list of available models with their capabilities"""
        models_info = []
        for model_type, config in self.models.items():
            models_info.append({
                "model_type": model_type.value,
                "provider": config.provider.value,
                "supports_images": config.supports_images,
                "max_tokens": config.max_tokens,
                "priority": config.priority,
                "description": f"{config.provider.value.title()} model with {'image' if config.supports_images else 'text-only'} support"
            })
        return sorted(models_info, key=lambda x: x["priority"])