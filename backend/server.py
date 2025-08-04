from fastapi import FastAPI, APIRouter, UploadFile, File, HTTPException, Form
from fastapi.responses import HTMLResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime
import base64
import asyncio
from emergentintegrations.llm.chat import LlmChat, UserMessage, FileContentWithMimeType

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

# Gemini API configuration
GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY')

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

class ChatRequest(BaseModel):
    session_id: str
    message: str
    current_code: Optional[str] = None

class ProjectSession(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    image_base64: str
    technology: str
    generated_code: Optional[str] = None  # Made optional to handle None responses
    chat_messages: List[dict] = []
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

# Code generation templates
FRAMEWORK_TEMPLATES = {
    "react": """
You are an expert React developer. Analyze this UI screenshot and generate clean, modern React code.

Requirements:
- Use functional components with hooks
- Use Tailwind CSS for styling
- Make it fully responsive
- Include proper semantic HTML
- Add interactive elements where appropriate
- Use modern React best practices
- Generate complete component code
- Return ONLY the component code without markdown formatting

Generate ONLY the React component code, no explanations or markdown.
    """,
    "angular": """
You are an expert Angular developer. Analyze this UI screenshot and generate clean, modern Angular code.

Requirements:
- Use Angular 15+ features
- Use Angular Material or Tailwind CSS
- Make it fully responsive
- Include proper TypeScript types
- Add interactive elements where appropriate
- Use modern Angular best practices
- Generate complete component code

Generate ONLY the Angular component code, no explanations.
    """,
    "vue": """
You are an expert Vue.js developer. Analyze this UI screenshot and generate clean, modern Vue code.

Requirements:
- Use Vue 3 Composition API
- Use Tailwind CSS for styling
- Make it fully responsive
- Include proper TypeScript if applicable
- Add interactive elements where appropriate
- Use modern Vue best practices
- Generate complete component code

Generate ONLY the Vue component code, no explanations.
    """,
    "svelte": """
You are an expert Svelte developer. Analyze this UI screenshot and generate clean, modern Svelte code.

Requirements:
- Use modern Svelte features
- Use Tailwind CSS for styling
- Make it fully responsive
- Include proper reactive statements
- Add interactive elements where appropriate
- Use modern Svelte best practices
- Generate complete component code

Generate ONLY the Svelte component code, no explanations.
    """,
    "html": """
You are an expert web developer. Analyze this UI screenshot and generate clean, modern HTML/CSS/JS code.

Requirements:
- Use semantic HTML5
- Use modern CSS with Flexbox/Grid
- Make it fully responsive
- Include vanilla JavaScript for interactivity
- Use modern web standards
- Generate complete HTML document

Generate ONLY the HTML/CSS/JS code, no explanations.
    """
}

def create_gemini_chat(session_id: str = None):
    """Create a Gemini chat instance"""
    return LlmChat(
        api_key=GEMINI_API_KEY
    )

@api_router.get("/")
async def get_root():
    return {"message": "Vision to Code Generator API"}

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
    Upload an image and generate code for the specified technology
    """
    try:
        logger.info(f"Received request for technology: {technology}")
        
        # Validate file type
        if not file.content_type.startswith('image/'):
            raise HTTPException(status_code=400, detail="File must be an image")
        
        # Read and encode image
        contents = await file.read()
        image_base64 = base64.b64encode(contents).decode('utf-8')
        
        # Create session
        session_id = str(uuid.uuid4())
        
        # Generate code using Gemini
        try:
            chat = create_gemini_chat(session_id)
            
            # Get framework-specific prompt
            system_prompt = FRAMEWORK_TEMPLATES.get(technology, FRAMEWORK_TEMPLATES["react"])
            
            # Add user comments to the prompt if provided
            user_requirements = ""
            if comments and comments.strip():
                user_requirements = f"\n\nAdditional Requirements from User:\n{comments.strip()}\n\nPlease incorporate these requirements into the generated code."
            
            # Save image temporarily for processing
            import tempfile
            with tempfile.NamedTemporaryFile(delete=False, suffix='.png') as temp_file:
                temp_file.write(contents)
                temp_file_path = temp_file.name
            
            # Create message with image
            user_message = UserMessage(
                text=system_prompt + f"\n\nGenerate {technology} code for this UI screenshot.{user_requirements}",
                file_contents=[FileContentWithMimeType(
                    mime_type=file.content_type,
                    file_path=temp_file_path
                )]
            )
            
            # Get AI response with validation
            logger.info("Sending message to Gemini...")
            generated_code = await chat.send_message(user_message)
            
            # Clean up temporary file
            os.unlink(temp_file_path)
            
            # Validate and clean the generated code
            if not generated_code or generated_code.strip() == "":
                logger.error("Gemini returned empty response")
                generated_code = f"""
// Error: Could not generate {technology} code from the provided image
// This might be due to:
// 1. Image quality issues
// 2. API limitations
// 3. Content policy restrictions

const ErrorComponent = () => {{
  return (
    <div className="p-6 bg-yellow-50 border-2 border-yellow-200 rounded-lg max-w-md mx-auto">
      <h3 className="text-lg font-bold text-yellow-800 mb-2">Generation Error</h3>
      <p className="text-yellow-700">
        Could not generate code from the provided image. Please try again with a different image or check if the image is clear and readable.
      </p>
    </div>
  );
}};

export default ErrorComponent;
"""
            
            # Clean the generated code
            cleaned_code = clean_generated_code(generated_code, technology)
            logger.info(f"Generated code length: {len(cleaned_code)}")
            
        except Exception as e:
            logger.error(f"Error generating code: {str(e)}")
            # Provide fallback code
            cleaned_code = create_fallback_code(technology, str(e))
        
        # Save to database
        session_data = ProjectSession(
            id=session_id,
            image_base64=image_base64,
            technology=technology,
            generated_code=cleaned_code,
            chat_messages=[{
                "type": "ai",
                "message": f"Generated {technology} code from your screenshot" + (" with your specific requirements!" if comments.strip() else ""),
                "timestamp": datetime.utcnow().isoformat()
            }]
        )
        
        await db.project_sessions.insert_one(session_data.dict())
        
        return {
            "session_id": session_id,
            "code": cleaned_code,
            "technology": technology,
            "message": "Code generated successfully"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in upload_and_generate: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

def clean_generated_code(code: str, technology: str) -> str:
    """Clean and validate generated code"""
    if not code:
        return create_fallback_code(technology, "Empty response")
    
    # Remove markdown code blocks
    cleaned = code.strip()
    
    # Remove common markdown patterns
    markdown_patterns = [
        r'```jsx\s*\n?',
        r'```javascript\s*\n?', 
        r'```js\s*\n?',
        r'```react\s*\n?',
        r'```typescript\s*\n?',
        r'```ts\s*\n?',
        r'```html\s*\n?',
        r'```css\s*\n?',
        r'```vue\s*\n?',
        r'```angular\s*\n?',
        r'```svelte\s*\n?',
        r'```\s*$'
    ]
    
    import re
    for pattern in markdown_patterns:
        cleaned = re.sub(pattern, '', cleaned, flags=re.MULTILINE)
    
    return cleaned.strip()

def create_fallback_code(technology: str, error_message: str) -> str:
    """Create fallback code when generation fails"""
    if technology == "react":
        return f"""import React from 'react';

const ErrorComponent = () => {{
  return (
    <div className="p-6 bg-red-50 border-2 border-red-200 rounded-lg max-w-md mx-auto">
      <h3 className="text-lg font-bold text-red-800 mb-2">Generation Error</h3>
      <p className="text-red-700 mb-2">
        Could not generate React code from the provided image.
      </p>
      <details>
        <summary className="cursor-pointer text-sm text-red-600">Error Details</summary>
        <pre className="text-xs mt-2 p-2 bg-red-100 rounded">{error_message}</pre>
      </details>
    </div>
  );
}};

export default ErrorComponent;"""
    
    return f"/* Error generating {technology} code: {error_message} */"

@api_router.post("/chat")
async def chat_endpoint(request: ChatRequest):
    """
    Chat endpoint for iterative code improvements
    """
    try:
        # Get session from database
        session = await db.project_sessions.find_one({"id": request.session_id})
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        
        # Create chat instance
        chat = create_gemini_chat(request.session_id)
        
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
        "https://uirender-doctor.preview.emergentagent.com",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "*"
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)