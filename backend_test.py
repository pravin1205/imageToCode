#!/usr/bin/env python3
"""
Backend API Testing for Screenshot-to-Code Generator
Tests all backend endpoints with real data and scenarios
"""

import requests
import json
import base64
import io
from PIL import Image
import time
import os
from pathlib import Path

# Configuration
BACKEND_URL = "https://df770ecb-0245-4014-b698-23edab3fc5c5.preview.emergentagent.com/api"
TEST_RESULTS = []

def log_test(test_name, status, details=""):
    """Log test results"""
    result = {
        "test": test_name,
        "status": status,
        "details": details,
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S")
    }
    TEST_RESULTS.append(result)
    print(f"[{status}] {test_name}: {details}")

def create_test_image():
    """Create a simple test image for upload testing"""
    # Create a simple UI mockup image
    img = Image.new('RGB', (400, 300), color='white')
    
    # Add some basic UI elements (simulate a simple form)
    from PIL import ImageDraw, ImageFont
    draw = ImageDraw.Draw(img)
    
    # Draw a simple form layout
    draw.rectangle([50, 50, 350, 80], outline='black', width=2)  # Header
    draw.rectangle([50, 100, 350, 130], outline='gray', width=1)  # Input field
    draw.rectangle([50, 150, 350, 180], outline='gray', width=1)  # Input field
    draw.rectangle([150, 200, 250, 230], fill='blue', outline='blue')  # Button
    
    # Add text
    try:
        draw.text((60, 60), "Contact Form", fill='black')
        draw.text((60, 110), "Name:", fill='black')
        draw.text((60, 160), "Email:", fill='black')
        draw.text((175, 210), "Submit", fill='white')
    except:
        pass  # Font might not be available
    
    # Convert to bytes
    img_byte_arr = io.BytesIO()
    img.save(img_byte_arr, format='PNG')
    img_byte_arr.seek(0)
    
    return img_byte_arr.getvalue()

def test_health_check():
    """Test the basic health check endpoint"""
    try:
        response = requests.get(f"{BACKEND_URL}/", timeout=10)
        if response.status_code == 200:
            data = response.json()
            if "message" in data:
                log_test("Health Check", "PASS", f"API is responding: {data['message']}")
                return True
            else:
                log_test("Health Check", "FAIL", "Response missing message field")
                return False
        else:
            log_test("Health Check", "FAIL", f"HTTP {response.status_code}: {response.text}")
            return False
    except Exception as e:
        log_test("Health Check", "FAIL", f"Connection error: {str(e)}")
        return False

def test_file_upload_and_generation():
    """Test the main file upload and code generation endpoint"""
    try:
        # Create test image
        test_image = create_test_image()
        
        # Test different technologies
        technologies = ["react", "vue", "angular", "svelte", "html"]
        
        for tech in technologies:
            try:
                files = {
                    'file': ('test_ui.png', test_image, 'image/png')
                }
                data = {
                    'technology': tech
                }
                
                response = requests.post(
                    f"{BACKEND_URL}/upload-and-generate",
                    files=files,
                    data=data,
                    timeout=30
                )
                
                if response.status_code == 200:
                    result = response.json()
                    required_fields = ['session_id', 'code', 'technology', 'image_base64']
                    
                    if all(field in result for field in required_fields):
                        # Check if we got a meaningful response (not just error message)
                        if len(result['code']) > 50 and not "blank" in result['code'].lower():
                            log_test(f"Code Generation ({tech})", "PASS", 
                                   f"Generated {len(result['code'])} chars of code")
                            
                            # Store session_id for later tests
                            if tech == "react":  # Use React session for subsequent tests
                                global test_session_id
                                test_session_id = result['session_id']
                        else:
                            log_test(f"Code Generation ({tech})", "PARTIAL", 
                                   f"AI detected blank/simple image - {len(result['code'])} chars")
                    else:
                        missing = [f for f in required_fields if f not in result]
                        log_test(f"Code Generation ({tech})", "FAIL", 
                               f"Missing fields: {missing}")
                else:
                    log_test(f"Code Generation ({tech})", "FAIL", 
                           f"HTTP {response.status_code}: {response.text}")
                    
            except Exception as e:
                log_test(f"Code Generation ({tech})", "FAIL", f"Error: {str(e)}")
                
        return True
        
    except Exception as e:
        log_test("File Upload Setup", "FAIL", f"Setup error: {str(e)}")
        return False

def test_invalid_file_upload():
    """Test file upload with invalid file types"""
    try:
        # Test with text file
        files = {
            'file': ('test.txt', b'This is not an image', 'text/plain')
        }
        data = {
            'technology': 'react'
        }
        
        response = requests.post(
            f"{BACKEND_URL}/upload-and-generate",
            files=files,
            data=data,
            timeout=10
        )
        
        if response.status_code == 400:
            log_test("Invalid File Upload", "PASS", "Correctly rejected non-image file")
            return True
        else:
            log_test("Invalid File Upload", "FAIL", 
                   f"Should reject non-image files, got HTTP {response.status_code}")
            return False
            
    except Exception as e:
        log_test("Invalid File Upload", "FAIL", f"Error: {str(e)}")
        return False

def test_chat_functionality():
    """Test the chat endpoint"""
    try:
        if 'test_session_id' not in globals():
            log_test("Chat Functionality", "SKIP", "No session ID available from previous tests")
            return False
            
        chat_request = {
            "session_id": test_session_id,
            "message": "Can you make the button larger and change the color to green?",
            "current_code": "// Previous code here"
        }
        
        response = requests.post(
            f"{BACKEND_URL}/chat",
            json=chat_request,
            headers={'Content-Type': 'application/json'},
            timeout=30
        )
        
        if response.status_code == 200:
            result = response.json()
            if 'response' in result and 'session_id' in result:
                if len(result['response']) > 10:
                    log_test("Chat Functionality", "PASS", 
                           f"AI responded with {len(result['response'])} chars")
                    return True
                else:
                    log_test("Chat Functionality", "FAIL", "AI response too short")
                    return False
            else:
                log_test("Chat Functionality", "FAIL", "Missing response fields")
                return False
        else:
            log_test("Chat Functionality", "FAIL", 
                   f"HTTP {response.status_code}: {response.text}")
            return False
            
    except Exception as e:
        log_test("Chat Functionality", "FAIL", f"Error: {str(e)}")
        return False

def test_session_retrieval():
    """Test session retrieval endpoints"""
    try:
        if 'test_session_id' not in globals():
            log_test("Session Retrieval", "SKIP", "No session ID available")
            return False
            
        # Test individual session retrieval
        response = requests.get(f"{BACKEND_URL}/session/{test_session_id}", timeout=10)
        
        if response.status_code == 200:
            session = response.json()
            required_fields = ['id', 'image_base64', 'technology', 'generated_code']
            
            if all(field in session for field in required_fields):
                log_test("Individual Session Retrieval", "PASS", 
                       f"Retrieved session with {len(session['generated_code'])} chars of code")
            else:
                missing = [f for f in required_fields if f not in session]
                log_test("Individual Session Retrieval", "FAIL", f"Missing fields: {missing}")
                return False
        else:
            log_test("Individual Session Retrieval", "FAIL", 
                   f"HTTP {response.status_code}: {response.text}")
            return False
            
        # Test all sessions retrieval
        response = requests.get(f"{BACKEND_URL}/sessions", timeout=10)
        
        if response.status_code == 200:
            sessions = response.json()
            if isinstance(sessions, list) and len(sessions) > 0:
                log_test("All Sessions Retrieval", "PASS", f"Retrieved {len(sessions)} sessions")
                return True
            else:
                log_test("All Sessions Retrieval", "FAIL", "No sessions returned or invalid format")
                return False
        else:
            log_test("All Sessions Retrieval", "FAIL", 
                   f"HTTP {response.status_code}: {response.text}")
            return False
            
    except Exception as e:
        log_test("Session Retrieval", "FAIL", f"Error: {str(e)}")
        return False

def test_invalid_session():
    """Test retrieval of non-existent session"""
    try:
        fake_session_id = "00000000-0000-0000-0000-000000000000"
        response = requests.get(f"{BACKEND_URL}/session/{fake_session_id}", timeout=10)
        
        if response.status_code == 404:
            log_test("Invalid Session Handling", "PASS", "Correctly returned 404 for invalid session")
            return True
        else:
            log_test("Invalid Session Handling", "FAIL", 
                   f"Should return 404 for invalid session, got HTTP {response.status_code}")
            return False
            
    except Exception as e:
        log_test("Invalid Session Handling", "FAIL", f"Error: {str(e)}")
        return False

def test_gemini_integration():
    """Test if Gemini AI integration is working properly"""
    try:
        # This is tested indirectly through code generation
        # Check if we got meaningful responses in previous tests
        code_gen_tests = [r for r in TEST_RESULTS if "Code Generation" in r["test"] and r["status"] == "PASS"]
        chat_tests = [r for r in TEST_RESULTS if "Chat Functionality" in r["test"] and r["status"] == "PASS"]
        
        if len(code_gen_tests) > 0 and len(chat_tests) > 0:
            log_test("Gemini AI Integration", "PASS", 
                   f"AI working in {len(code_gen_tests)} code generation tests and chat")
            return True
        elif len(code_gen_tests) > 0:
            log_test("Gemini AI Integration", "PARTIAL", 
                   "Code generation working but chat may have issues")
            return True
        else:
            log_test("Gemini AI Integration", "FAIL", 
                   "No successful AI interactions detected")
            return False
            
    except Exception as e:
        log_test("Gemini AI Integration", "FAIL", f"Error: {str(e)}")
        return False

def run_all_tests():
    """Run all backend tests"""
    print("=" * 60)
    print("BACKEND API TESTING - Screenshot to Code Generator")
    print("=" * 60)
    print(f"Testing backend at: {BACKEND_URL}")
    print()
    
    # Initialize global session variable
    global test_session_id
    test_session_id = None
    
    # Run tests in order
    tests = [
        ("Basic Connectivity", test_health_check),
        ("File Upload & Code Generation", test_file_upload_and_generation),
        ("Invalid File Handling", test_invalid_file_upload),
        ("Chat Functionality", test_chat_functionality),
        ("Session Management", test_session_retrieval),
        ("Invalid Session Handling", test_invalid_session),
        ("Gemini AI Integration", test_gemini_integration),
    ]
    
    passed = 0
    failed = 0
    skipped = 0
    
    for test_name, test_func in tests:
        print(f"\nRunning: {test_name}")
        print("-" * 40)
        
        try:
            result = test_func()
            if result:
                passed += 1
            else:
                failed += 1
        except Exception as e:
            log_test(test_name, "ERROR", f"Test execution failed: {str(e)}")
            failed += 1
    
    # Count skipped tests
    skipped = len([r for r in TEST_RESULTS if r["status"] == "SKIP"])
    
    # Print summary
    print("\n" + "=" * 60)
    print("TEST SUMMARY")
    print("=" * 60)
    
    for result in TEST_RESULTS:
        status_symbol = "✅" if result["status"] == "PASS" else "❌" if result["status"] == "FAIL" else "⚠️"
        print(f"{status_symbol} {result['test']}: {result['details']}")
    
    print(f"\nTotal Tests: {len(TEST_RESULTS)}")
    print(f"Passed: {passed}")
    print(f"Failed: {failed}")
    print(f"Skipped: {skipped}")
    
    # Determine overall status
    critical_failures = [r for r in TEST_RESULTS if r["status"] == "FAIL" and 
                        any(critical in r["test"] for critical in ["Health Check", "Code Generation", "Gemini AI"])]
    
    if len(critical_failures) == 0:
        print("\n🎉 BACKEND TESTS: OVERALL PASS")
        return True
    else:
        print(f"\n💥 BACKEND TESTS: CRITICAL FAILURES DETECTED ({len(critical_failures)})")
        return False

if __name__ == "__main__":
    success = run_all_tests()
    exit(0 if success else 1)