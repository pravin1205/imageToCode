from fastapi import FastAPI, APIRouter, UploadFile, File, HTTPException, Form
from fastapi.responses import HTMLResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime
import base64
import asyncio

# Import the new Multi-AI service
from ai_models.multi_ai_service import MultiAIService, GenerationResult

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Initialize Multi-AI Service
multi_ai_service = MultiAIService()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Define Models
class StatusCheck(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class StatusCheckCreate(BaseModel):
    client_name: str

class CodeGenerationRequest(BaseModel):
    image_base64: str
    technology: str
    session_id: str

class CodeGenerationResponse(BaseModel):
    code: str
    technology: str
    session_id: str
    model_used: str
    all_models_tried: List[str]
    generation_time: float

class ChatRequest(BaseModel):
    session_id: str
    message: str
    current_code: Optional[str] = None

class ProjectSession(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    image_base64: str
    technology: str
    generated_code: Optional[str] = None
    chat_messages: List[dict] = []
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    model_used: Optional[str] = None
    all_models_tried: List[str] = []

@api_router.get("/")
async def get_root():
    return {"message": "Enhanced Multi-AI Vision to Code Generator API"}

@api_router.get("/models")
async def get_available_models():
    """Get list of available AI models"""
    try:
        models = multi_ai_service.get_available_models()
        return {
            "available_models": models,
            "total_models": len(models),
            "image_support_models": len([m for m in models if m["supports_images"]]),
            "text_only_models": len([m for m in models if not m["supports_images"]])
        }
    except Exception as e:
        logger.error(f"Error getting available models: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to get available models")

@api_router.post("/status-check")
async def create_status_check(status: StatusCheckCreate):
    status_check = StatusCheck(client_name=status.client_name)
    result = await db.status_checks.insert_one(status_check.dict())
    return {"id": str(result.inserted_id), "message": f"Status check created for {status.client_name}"}

@api_router.get("/status-checks")
async def get_status_checks():
    status_checks = []
    async for status in db.status_checks.find():
        status['_id'] = str(status['_id'])
        status_checks.append(status)
    return status_checks

@api_router.post("/upload-and-generate")
async def upload_and_generate(
    file: UploadFile = File(...),
    technology: str = Form(...),
    comments: str = Form(default="")
):
    """
    Enhanced upload and generate with Multi-AI support
    """
    try:
        logger.info(f"Multi-AI request for technology: {technology}")
        
        # Validate file type
        if not file.content_type.startswith('image/'):
            raise HTTPException(status_code=400, detail="File must be an image")
        
        # Read image data
        contents = await file.read()
        image_base64 = base64.b64encode(contents).decode('utf-8')
        
        # Create session
        session_id = str(uuid.uuid4())
        
        # Generate code using Multi-AI service
        start_time = asyncio.get_event_loop().time()
        
        try:
            best_result, all_results = await multi_ai_service.generate_code_multi_ai(
                prompt=f"Generate {technology} code for this UI screenshot",
                technology=technology,
                image_data=contents,
                user_comments=comments,
                max_models=3  # Try up to 3 models
            )
            
            generation_time = asyncio.get_event_loop().time() - start_time
            
            if not best_result or not best_result.success:
                raise ValueError("All AI models failed to generate code")
            
            # Prepare response data
            all_models_tried = [r.model_type.value for r in all_results]
            
            logger.info(f"Multi-AI generation successful. Best model: {best_result.model_type.value}")
            logger.info(f"Models tried: {all_models_tried}")
            
        except Exception as e:
            logger.error(f"Multi-AI generation failed: {str(e)}")
            # Fallback to error handling
            best_result = GenerationResult(
                model_type=None,
                provider=None,
                success=True,
                code=create_fallback_code(technology, str(e))
            )
            all_results = []
            generation_time = 0.1
        
        # Save to database
        session_data = ProjectSession(
            id=session_id,
            image_base64=image_base64,
            technology=technology,
            generated_code=best_result.code,
            model_used=best_result.model_type.value if best_result.model_type else "fallback",
            all_models_tried=[r.model_type.value for r in all_results] if all_results else [],
            chat_messages=[{
                "type": "ai",
                "message": f"Generated {technology} code using {best_result.model_type.value if best_result.model_type else 'fallback'} model" + 
                          (" with your specific requirements!" if comments.strip() else ""),
                "timestamp": datetime.utcnow().isoformat()
            }]
        )
        
        await db.project_sessions.insert_one(session_data.dict())
        
        return {
            "session_id": session_id,
            "code": best_result.code,
            "technology": technology,
            "model_used": best_result.model_type.value if best_result.model_type else "fallback",
            "all_models_tried": [r.model_type.value for r in all_results] if all_results else [],
            "generation_time": generation_time,
            "message": "Code generated successfully using Multi-AI system"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in upload_and_generate: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

def create_fallback_code(technology: str, error_message: str) -> str:
    """Create fallback code when all AI models fail"""
    if technology.lower() == "react":
        return f"""import React from 'react';

const ErrorComponent = () => {{
  return (
    <div className="p-6 bg-yellow-50 border-2 border-yellow-200 rounded-lg max-w-md mx-auto">
      <h3 className="text-lg font-bold text-yellow-800 mb-2">Multi-AI Generation Notice</h3>
      <p className="text-yellow-700 mb-2">
        All AI models are currently unavailable, but here's a basic component structure.
      </p>
      <details>
        <summary className="cursor-pointer text-sm text-yellow-600">Technical Details</summary>
        <pre className="text-xs mt-2 p-2 bg-yellow-100 rounded">{error_message[:200]}...</pre>
      </details>
      <div className="mt-4 p-3 bg-white rounded border">
        <p className="text-sm">Replace this content with your actual UI components.</p>
      </div>
    </div>
  );
}};

export default ErrorComponent;"""
    
    return f"/* Multi-AI Generation Error: {error_message} */"

@api_router.post("/chat")
async def chat_endpoint(request: ChatRequest):
    """
    Enhanced chat endpoint that can use multi-AI for responses
    """
    try:
        # Get session from database
        session = await db.project_sessions.find_one({"id": request.session_id})
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        
        # For chat, we'll use a simpler single-model approach for now
        # Could be enhanced to use multi-AI for complex requests
        
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        
        # Create chat instance using Gemini (primary model)
        gemini_key = os.environ.get('GEMINI_API_KEY')
        if not gemini_key:
            raise ValueError("GEMINI_API_KEY not configured")
            
        chat = LlmChat(
            session_id=request.session_id,
            system_message="You are an expert frontend developer helping improve existing code.",
            api_key=gemini_key
        ).with_model("gemini", "gemini-1.5-flash")
        
        # Create context message
        context = f"""
You are helping improve existing {session['technology']} code based on user feedback.

Current code:
{request.current_code or session.get('generated_code', '')}

User request: {request.message}

Please provide an improved version of the code that addresses the user's request.
Return ONLY the updated code, no explanations.
"""
        
        user_message = UserMessage(text=context)
        
        # Get AI response
        response = await chat.send_message(user_message)
        
        if not response:
            response = "I apologize, but I couldn't process your request. Please try rephrasing your message."
        
        # Clean the response
        cleaned_response = clean_generated_code(response, session['technology'])
        
        # Update session with new chat message
        chat_message = {
            "type": "user",
            "message": request.message,
            "timestamp": datetime.utcnow().isoformat()
        }
        
        ai_message = {
            "type": "ai", 
            "message": cleaned_response,
            "timestamp": datetime.utcnow().isoformat()
        }
        
        await db.project_sessions.update_one(
            {"id": request.session_id},
            {
                "$push": {
                    "chat_messages": {"$each": [chat_message, ai_message]}
                },
                "$set": {
                    "updated_at": datetime.utcnow(),
                    "generated_code": cleaned_response
                }
            }
        )
        
        return {
            "response": cleaned_response,
            "session_id": request.session_id
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in chat endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

def clean_generated_code(code: str, technology: str) -> str:
    """Clean and validate generated code"""
    if not code:
        return create_fallback_code(technology, "Empty response")
    
    # Remove markdown code blocks
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

@api_router.get("/sessions/{session_id}")
async def get_session(session_id: str):
    """Get a specific session"""
    session = await db.project_sessions.find_one({"id": session_id})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    # Remove MongoDB _id field
    if '_id' in session:
        del session['_id']
    
    return session

@api_router.get("/sessions")
async def get_all_sessions():
    """Get all sessions"""
    sessions = []
    async for session in db.project_sessions.find().sort("created_at", -1):
        # Remove MongoDB _id field
        if '_id' in session:
            del session['_id']
        sessions.append(session)
    
    return sessions

# Include the API router
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://3cb4c910-e7f8-4acb-a3fc-3b73c971dcee.preview.emergentagent.com",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "*"
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)