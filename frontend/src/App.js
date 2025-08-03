import React, { useState, useRef } from "react";
import "./App.css";
import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const TECHNOLOGIES = [
  { value: "react", label: "React", icon: "⚛️" },
  { value: "angular", label: "Angular", icon: "🅰️" },
  { value: "vue", label: "Vue.js", icon: "💚" },
  { value: "svelte", label: "Svelte", icon: "🧡" },
  { value: "html", label: "HTML + CSS + JS", icon: "🌐" }
];

const PREVIEW_MODES = [
  { value: "desktop", label: "Desktop", icon: "🖥️", width: "100%" },
  { value: "tablet", label: "Tablet", icon: "📱", width: "768px" },
  { value: "mobile", label: "Mobile", icon: "📲", width: "375px" }
];

function App() {
  const [selectedTech, setSelectedTech] = useState("react");
  const [previewMode, setPreviewMode] = useState("desktop");
  const [uploadedImage, setUploadedImage] = useState(null);
  const [generatedCode, setGeneratedCode] = useState("");
  const [sessionId, setSessionId] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [isChatting, setIsChatting] = useState(false);
  const fileInputRef = useRef(null);

  const handleFileUpload = async (file) => {
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }

    // Create preview
    const reader = new FileReader();
    reader.onload = (e) => {
      setUploadedImage(e.target.result);
    };
    reader.readAsDataURL(file);

    // Generate code
    setIsGenerating(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('technology', selectedTech);

      const response = await axios.post(`${API}/upload-and-generate`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });

      setGeneratedCode(response.data.code);
      setSessionId(response.data.session_id);
      setChatMessages([{
        type: 'ai',
        message: `Generated ${selectedTech} code from your screenshot! You can now preview it and ask for modifications.`,
        timestamp: new Date().toISOString()
      }]);

    } catch (error) {
      console.error('Code generation failed:', error);
      alert('Code generation failed. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileUpload(files[0]);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      handleFileUpload(file);
    }
  };

  const handleChatSubmit = async (e) => {
    e.preventDefault();
    if (!chatInput.trim() || !sessionId) return;

    const userMessage = {
      type: 'user',
      message: chatInput,
      timestamp: new Date().toISOString()
    };

    setChatMessages(prev => [...prev, userMessage]);
    setIsChatting(true);

    try {
      const response = await axios.post(`${API}/chat`, {
        session_id: sessionId,
        message: chatInput,
        current_code: generatedCode
      });

      const aiMessage = {
        type: 'ai',
        message: response.data.response,
        timestamp: new Date().toISOString()
      };

      setChatMessages(prev => [...prev, aiMessage]);

      // If response contains code, update the generated code
      if (response.data.response.includes('```')) {
        // Extract code from response (basic extraction)
        const codeMatch = response.data.response.match(/```[\w]*\n([\s\S]*?)\n```/);
        if (codeMatch) {
          setGeneratedCode(codeMatch[1]);
        }
      }

    } catch (error) {
      console.error('Chat failed:', error);
      setChatMessages(prev => [...prev, {
        type: 'ai',
        message: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date().toISOString()
      }]);
    } finally {
      setIsChatting(false);
      setChatInput('');
    }
  };

  const renderPreview = () => {
    if (!generatedCode) return null;

    // Clean and prepare the generated code for preview
    let previewContent = generatedCode.trim();
    
    // Create proper HTML document for iframe
    const createPreviewHTML = () => {
      // For React code
      if (selectedTech === 'react') {
        // Extract the component code and clean it
        let componentCode = previewContent;
        
        // Remove export statements and clean the code
        componentCode = componentCode.replace(/export\s+default\s+\w+;?\s*$/, '');
        componentCode = componentCode.replace(/import.*from.*['"].*['"];?\s*/g, '');
        
        return `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
            <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
            <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
            <script src="https://cdn.tailwindcss.com"></script>
            <style>
              body { margin: 0; padding: 10px; font-family: system-ui, -apple-system, sans-serif; background: white; }
              * { box-sizing: border-box; }
            </style>
          </head>
          <body>
            <div id="root"></div>
            <script type="text/babel">
              try {
                // Make React hooks available globally
                const { useState, useEffect, useContext, useReducer, useCallback, useMemo, useRef, useImperativeHandle, useLayoutEffect, useDebugValue } = React;
                
                // Also make common React functions available
                const { createElement, Component, PureComponent, Fragment } = React;
                
                ${componentCode}
                
                // Try to extract and render the component
                let ComponentToRender;
                
                // Look for function component
                const funcMatch = componentCode.match(/function\\s+(\\w+)/);
                if (funcMatch) {
                  ComponentToRender = window[funcMatch[1]];
                }
                
                // Look for const component
                if (!ComponentToRender) {
                  const constMatch = componentCode.match(/const\\s+(\\w+)\\s*=/);
                  if (constMatch) {
                    ComponentToRender = window[constMatch[1]];
                  }
                }
                
                // Look for arrow function component
                if (!ComponentToRender) {
                  const arrowMatch = componentCode.match(/const\\s+(\\w+)\\s*=.*=>/);
                  if (arrowMatch) {
                    ComponentToRender = window[arrowMatch[1]];
                  }
                }
                
                // If we found a component, render it
                if (ComponentToRender && typeof ComponentToRender === 'function') {
                  const root = ReactDOM.createRoot(document.getElementById('root'));
                  root.render(React.createElement(ComponentToRender));
                } else {
                  // Fallback: try to execute the code and render any JSX return
                  const root = ReactDOM.createRoot(document.getElementById('root'));
                  
                  // Create a wrapper component that executes the generated code
                  function GeneratedComponent() {
                    try {
                      // If the code has a return statement with JSX, extract it
                      const returnMatch = componentCode.match(/return\\s*\\(([\\s\\S]*?)\\);?$/);
                      if (returnMatch) {
                        // Extract JSX content
                        const jsxContent = returnMatch[1].trim();
                        return eval('(' + jsxContent + ')');
                      } else if (componentCode.includes('return')) {
                        // Simple return statement
                        const simpleReturnMatch = componentCode.match(/return\\s*([^;]+);?$/);
                        if (simpleReturnMatch) {
                          return eval(simpleReturnMatch[1]);
                        }
                      }
                      
                      // If no return found, wrap the code in a div
                      return React.createElement('div', {className: 'p-4'}, 
                        React.createElement('pre', {className: 'bg-gray-100 p-4 rounded'}, componentCode)
                      );
                    } catch (error) {
                      return React.createElement('div', {
                        className: 'p-4 bg-red-50 border border-red-200 rounded text-red-700'
                      }, 'Preview Error: ' + error.message);
                    }
                  }
                  
                  root.render(React.createElement(GeneratedComponent));
                }
              } catch (error) {
                console.error('Preview error:', error);
                document.getElementById('root').innerHTML = '<div style="padding: 20px; color: #ef4444; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; font-family: system-ui;">Preview Error: ' + error.message + '<br><br>Generated Code:<br><pre style="background: #f8f9fa; padding: 10px; border-radius: 4px; font-size: 12px; overflow: auto;">' + \`${componentCode.replace(/\`/g, '\\`')}\` + '</pre></div>';
              }
            </script>
          </body>
          </html>
        `;
      }
      
      // For HTML/CSS/JS
      if (selectedTech === 'html') {
        return previewContent.includes('<!DOCTYPE') ? previewContent : `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
              body { margin: 0; padding: 10px; font-family: system-ui, -apple-system, sans-serif; }
            </style>
          </head>
          <body>
            ${previewContent}
          </body>
          </html>
        `;
      }
      
      // For other frameworks, show code as text for now
      return `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { margin: 0; padding: 20px; font-family: monospace; background: #f8f9fa; }
            .code-preview { background: white; padding: 20px; border-radius: 8px; border: 1px solid #dee2e6; }
            pre { margin: 0; white-space: pre-wrap; word-wrap: break-word; }
          </style>
        </head>
        <body>
          <div class="code-preview">
            <h3>Generated ${selectedTech.toUpperCase()} Code:</h3>
            <pre>${previewContent.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
          </div>
        </body>
        </html>
      `;
    };

    return (
      <div className="bg-white border rounded-lg overflow-hidden shadow-sm">
        <div className="bg-gray-50 px-4 py-2 border-b flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">Live Preview</span>
          <div className="flex space-x-2">
            {PREVIEW_MODES.map(mode => (
              <button
                key={mode.value}
                onClick={() => setPreviewMode(mode.value)}
                className={`px-3 py-1 text-xs rounded ${
                  previewMode === mode.value
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                {mode.icon} {mode.label}
              </button>
            ))}
          </div>
        </div>
        <div className="p-4 bg-gray-50 min-h-96">
          <div 
            className="bg-white border rounded mx-auto transition-all duration-300 overflow-hidden"
            style={{ 
              width: PREVIEW_MODES.find(m => m.value === previewMode)?.width || '100%',
              maxWidth: '100%'
            }}
          >
            <iframe
              key={`${selectedTech}-${previewMode}-${generatedCode.length}`}
              srcDoc={createPreviewHTML()}
              className="w-full h-96 border-0"
              title="Code Preview"
              sandbox="allow-scripts allow-same-origin"
              onLoad={() => {
                console.log('Preview iframe loaded successfully');
              }}
            />
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Screenshot to Code Generator</h1>
              <p className="text-gray-600">Upload a UI screenshot and get instant, responsive code</p>
            </div>
            <div className="flex items-center space-x-4">
              <label className="text-sm font-medium text-gray-700">Technology:</label>
              <select
                value={selectedTech}
                onChange={(e) => setSelectedTech(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {TECHNOLOGIES.map(tech => (
                  <option key={tech.value} value={tech.value}>
                    {tech.icon} {tech.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Upload Section */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Upload Screenshot</h2>
              
              {/* Upload Area */}
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-all ${
                  uploadedImage ? 'border-green-400 bg-green-50' : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50'
                }`}
              >
                {uploadedImage ? (
                  <div>
                    <img src={uploadedImage} alt="Uploaded" className="max-w-full h-48 object-contain mx-auto mb-4" />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="text-blue-600 hover:text-blue-800 font-medium"
                    >
                      Upload Different Image
                    </button>
                  </div>
                ) : (
                  <div>
                    <svg className="mx-auto h-12 w-12 text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48">
                      <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <p className="mt-2 text-sm text-gray-600">
                      Drop your screenshot here, or{" "}
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="text-blue-600 hover:text-blue-800 font-medium"
                      >
                        click to upload
                      </button>
                    </p>
                    <p className="text-xs text-gray-500 mt-1">PNG, JPG, SVG up to 10MB</p>
                  </div>
                )}
              </div>

              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                accept="image/*"
                className="hidden"
              />

              {isGenerating && (
                <div className="mt-4 text-center">
                  <div className="inline-flex items-center">
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Generating {selectedTech} code...
                  </div>
                </div>
              )}
            </div>

            {/* Chat Section */}
            {sessionId && (
              <div className="bg-white rounded-xl shadow-lg p-6 mt-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Feedback & Adjustments</h2>
                
                <div className="h-64 overflow-y-auto mb-4 p-4 bg-gray-50 rounded-lg">
                  {chatMessages.map((msg, index) => (
                    <div key={index} className={`mb-3 ${msg.type === 'user' ? 'text-right' : 'text-left'}`}>
                      <div className={`inline-block max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                        msg.type === 'user'
                          ? 'bg-blue-600 text-white'
                          : 'bg-white text-gray-800 border'
                      }`}>
                        <p className="text-sm">{msg.message}</p>
                      </div>
                    </div>
                  ))}
                  {isChatting && (
                    <div className="text-left">
                      <div className="inline-block bg-gray-200 px-4 py-2 rounded-lg">
                        <div className="flex space-x-1">
                          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <form onSubmit={handleChatSubmit} className="flex space-x-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Ask for changes: 'Make button blue', 'Center the header'..."
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    disabled={isChatting}
                  />
                  <button
                    type="submit"
                    disabled={isChatting || !chatInput.trim()}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Send
                  </button>
                </form>
              </div>
            )}
          </div>

          {/* Preview & Code Section */}
          <div className="lg:col-span-2 space-y-6">
            {generatedCode && renderPreview()}

            {generatedCode && (
              <div className="bg-white rounded-xl shadow-lg p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900">Generated Code</h2>
                  <button
                    onClick={() => navigator.clipboard.writeText(generatedCode)}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 text-sm"
                  >
                    📋 Copy Code
                  </button>
                </div>
                <div className="bg-gray-900 rounded-lg p-4 overflow-x-auto">
                  <pre className="text-green-400 text-sm">
                    <code>{generatedCode}</code>
                  </pre>
                </div>
              </div>
            )}

            {!generatedCode && !isGenerating && (
              <div className="bg-white rounded-xl shadow-lg p-12 text-center">
                <div className="text-gray-400 mb-4">
                  <svg className="mx-auto h-16 w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">Ready to Generate Code</h3>
                <p className="text-gray-600">Upload a UI screenshot to get started with AI-powered code generation</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;