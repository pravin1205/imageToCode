from fastapi import FastAPI, APIRouter, UploadFile, File, HTTPException
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
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class ChatMessage(BaseModel):
    session_id: str
    message: str
    type: str  # 'user' or 'ai'
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class ChatRequest(BaseModel):
    session_id: str
    message: str
    current_code: Optional[str] = None

class ProjectSession(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    image_base64: str
    technology: str
    generated_code: str
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

Generate ONLY the React component code, no explanations.
    """,
    "angular": """
You are an expert Angular developer. Analyze this UI screenshot and generate clean, modern Angular code.

Requirements:
- Use Angular 17+ syntax
- Use Tailwind CSS for styling
- Make it fully responsive
- Include proper TypeScript types
- Add interactive elements where appropriate
- Generate complete component code including .ts, .html, and .css files

Generate the Angular component code in this format:
// component.ts
// component.html
// component.css
    """,
    "vue": """
You are an expert Vue.js developer. Analyze this UI screenshot and generate clean, modern Vue 3 code.

Requirements:
- Use Vue 3 Composition API
- Use Tailwind CSS for styling
- Make it fully responsive
- Include proper TypeScript where needed
- Add interactive elements where appropriate
- Generate complete Single File Component

Generate ONLY the Vue SFC code, no explanations.
    """,
    "svelte": """
You are an expert Svelte developer. Analyze this UI screenshot and generate clean, modern Svelte code.

Requirements:
- Use modern Svelte syntax
- Use Tailwind CSS for styling
- Make it fully responsive
- Add interactive elements where appropriate
- Generate complete Svelte component

Generate ONLY the Svelte component code, no explanations.
    """,
    "html": """
You are an expert web developer. Analyze this UI screenshot and generate clean, modern HTML with CSS and JavaScript.

Requirements:
- Use semantic HTML5
- Use modern CSS (Flexbox, Grid)
- Make it fully responsive
- Include JavaScript for interactivity
- Use clean, maintainable code
- Generate complete HTML file

Generate the code in this format:
<!DOCTYPE html>
<html>
<head>...</head>
<body>...</body>
</html>
    """
}

# Helper function to create LLM chat instance
def create_gemini_chat(session_id: str) -> LlmChat:
    return LlmChat(
        api_key=GEMINI_API_KEY,
        session_id=session_id,
        system_message="You are an expert frontend developer specializing in converting UI screenshots into clean, responsive code."
    ).with_model("gemini", "gemini-2.5-flash-preview-04-17")

# Add your routes to the router instead of directly to app
@api_router.get("/")
async def root():
    return {"message": "Screenshot to Code Generator API"}

@api_router.post("/status", response_model=StatusCheck)
async def create_status_check(input: StatusCheckCreate):
    status_dict = input.dict()
    status_obj = StatusCheck(**status_dict)
    _ = await db.status_checks.insert_one(status_obj.dict())
    return status_obj

@api_router.get("/status", response_model=List[StatusCheck])
async def get_status_checks():
    status_checks = await db.status_checks.find().to_list(1000)
    return [StatusCheck(**status_check) for status_check in status_checks]

@api_router.post("/upload-and-generate")
async def upload_and_generate_code(file: UploadFile = File(...), technology: str = "react"):
    try:
        # Validate file type
        if not file.content_type.startswith('image/'):
            raise HTTPException(status_code=400, detail="File must be an image")
        
        # Read and encode image
        contents = await file.read()
        image_base64 = base64.b64encode(contents).decode('utf-8')
        
        # Create session
        session_id = str(uuid.uuid4())
        
        # Generate code using Gemini
        chat = create_gemini_chat(session_id)
        
        # Get framework-specific prompt
        system_prompt = FRAMEWORK_TEMPLATES.get(technology, FRAMEWORK_TEMPLATES["react"])
        
        # Save image temporarily for processing
        import tempfile
        with tempfile.NamedTemporaryFile(delete=False, suffix='.png') as temp_file:
            temp_file.write(contents)
            temp_file_path = temp_file.name
        
        # Create message with image
        user_message = UserMessage(
            text=system_prompt + f"\n\nGenerate {technology} code for this UI screenshot.",
            file_contents=[FileContentWithMimeType(
                mime_type=file.content_type,
                file_path=temp_file_path
            )]
        )
        
        # Get AI response
        generated_code = await chat.send_message(user_message)
        
        # Save to database
        session_data = ProjectSession(
            id=session_id,
            image_base64=image_base64,
            technology=technology,
            generated_code=generated_code,
            chat_messages=[{
                "type": "ai",
                "message": f"Generated {technology} code from your screenshot",
                "timestamp": datetime.utcnow().isoformat()
            }]
        )
        
        await db.project_sessions.insert_one(session_data.dict())
        
        return {
            "session_id": session_id,
            "code": generated_code,
            "technology": technology,
            "image_base64": image_base64
        }
        
    except Exception as e:
        logger.error(f"Code generation error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Code generation failed: {str(e)}")

@api_router.post("/chat")
async def chat_with_ai(request: ChatRequest):
    try:
        # Get session from database
        session = await db.project_sessions.find_one({"id": request.session_id})
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        
        # Create chat instance
        chat = create_gemini_chat(request.session_id)
        
        # Prepare context message
        context_message = f"""
Current generated code:
```{session['technology']}
{session['generated_code']}
```

User request: {request.message}

Please provide updated code or specific changes based on the user's request. 
If it's a modification request, provide the complete updated code.
If it's a question, provide a helpful answer.
        """
        
        user_message = UserMessage(text=context_message)
        response = await chat.send_message(user_message)
        
        # Update chat history
        chat_messages = session.get('chat_messages', [])
        chat_messages.extend([
            {
                "type": "user",
                "message": request.message,
                "timestamp": datetime.utcnow().isoformat()
            },
            {
                "type": "ai", 
                "message": response,
                "timestamp": datetime.utcnow().isoformat()
            }
        ])
        
        # Update session in database
        await db.project_sessions.update_one(
            {"id": request.session_id},
            {
                "$set": {
                    "chat_messages": chat_messages,
                    "updated_at": datetime.utcnow()
                }
            }
        )
        
        return {
            "response": response,
            "session_id": request.session_id
        }
        
    except Exception as e:
        logger.error(f"Chat error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Chat failed: {str(e)}")

@api_router.get("/session/{session_id}")
async def get_session(session_id: str):
    try:
        session = await db.project_sessions.find_one({"id": session_id})
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        
        return session
        
    except Exception as e:
        logger.error(f"Session retrieval error: {str(e)}")
        raise HTTPException(status_code=500, detail="Session retrieval failed")

@api_router.get("/sessions")
async def get_all_sessions():
    try:
        sessions = await db.project_sessions.find().to_list(100)
        return sessions
        
    except Exception as e:
        logger.error(f"Sessions retrieval error: {str(e)}")
        raise HTTPException(status_code=500, detail="Sessions retrieval failed")

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
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