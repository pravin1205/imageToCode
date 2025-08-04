import React, { useState, useRef } from "react";
import "./App.css";
import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const TECHNOLOGIES = [
  { value: "react", label: "React", icon: "⚛️", color: "bg-blue-100 text-blue-800" },
  { value: "angular", label: "Angular", icon: "🅰️", color: "bg-red-100 text-red-800" },
  { value: "vue", label: "Vue.js", icon: "💚", color: "bg-green-100 text-green-800" },
  { value: "svelte", label: "Svelte", icon: "🧡", color: "bg-orange-100 text-orange-800" },
  { value: "html", label: "HTML + CSS + JS", icon: "🌐", color: "bg-purple-100 text-purple-800" }
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
  const [uploadedFile, setUploadedFile] = useState(null);
  const [userComments, setUserComments] = useState("");
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

    // Store file for later generation
    setUploadedFile(file);
    
    // Clear previous results
    setGeneratedCode("");
    setSessionId(null);
    setChatMessages([]);
  };

  const handleGenerateCode = async () => {
    if (!uploadedFile) {
      alert('Please upload an image first');
      return;
    }

    setIsGenerating(true);
    try {
      const formData = new FormData();
      formData.append('file', uploadedFile);
      formData.append('technology', selectedTech);
      formData.append('comments', userComments);

      const response = await axios.post(`${API}/upload-and-generate`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });

      setGeneratedCode(response.data.code);
      setSessionId(response.data.session_id);
      setChatMessages([{
        type: 'ai',
        message: `Generated ${selectedTech} code from your screenshot! ${userComments ? 'I\'ve incorporated your specific requirements.' : ''} You can now preview it and ask for modifications.`,
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

  // Sanitize component code to prevent JavaScript injection and regex errors
  const sanitizeComponentCode = (code) => {
    if (!code) return '';
    
    try {
      // Fix common regex pattern issues that cause "unterminated regular expression" errors
      let sanitized = code;
      
      // Escape any malformed regex patterns
      // Look for potential problematic regex patterns and fix them
      sanitized = sanitized.replace(/\/([^\/\n]*)\[([^\]]*)(;|$)/g, (match, before, inside, after) => {
        // If we find a regex-like pattern that's incomplete, try to fix it
        if (!inside.includes(']')) {
          return `/${before}[${inside}]/${after}`;
        }
        return match;
      });
      
      // Fix incomplete regex patterns like /returns*([^;
      sanitized = sanitized.replace(/\/([^\/\n]*)\(\[\^([^;\]]*)(;|\)|$)/g, (match, before, inside, after) => {
        // Complete the character class and regex
        return `/${before}([^${inside}])${after}`;
      });
      
      // Remove any incomplete regex literals that start with / but don't have closing /
      sanitized = sanitized.replace(/\/[^\/\n]*\[([^\]\/\n]*)(;|\n|$)/g, (match) => {
        // If it looks like an incomplete regex, comment it out
        return `/* ${match.trim()} */`;
      });
      
      // Escape template literal backticks that could break the iframe template
      sanitized = sanitized.replace(/`/g, '\\`');
      
      // Escape ${} template expressions to prevent injection
      sanitized = sanitized.replace(/\$\{/g, '\\${');
      
      return sanitized;
    } catch (error) {
      console.error('Error sanitizing component code:', error);
      return code; // Return original if sanitization fails
    }
  };

  const renderPreview = () => {
    console.log('renderPreview called, generatedCode length:', generatedCode?.length);
    
    if (!generatedCode) {
      console.log('No generated code, returning null');
      return null;
    }

    console.log('Generated code preview:', generatedCode.substring(0, 200));

    // Clean and prepare the generated code for preview
    let previewContent = generatedCode.trim();
    
    // Create proper HTML document for iframe
    const createPreviewHTML = () => {
      console.log('createPreviewHTML called for technology:', selectedTech);
      
      try {
        // For React code
        if (selectedTech === 'react') {
        // Extract the component code and clean it
        let componentCode = previewContent;
        
        // CRITICAL FIX: Remove markdown code blocks that cause JavaScript syntax errors
        // Remove ```jsx, ```javascript, ```js, and ``` markers
        componentCode = componentCode.replace(/```(jsx|javascript|js|react)?\s*\n?/g, '');
        componentCode = componentCode.replace(/```\s*$/g, '');
        
        console.log('After markdown cleanup, componentCode preview:', componentCode.substring(0, 200));
        
        // Remove export statements and clean the code
        componentCode = componentCode.replace(/export\s+default\s+\w+;?\s*$/, '');
        componentCode = componentCode.replace(/import.*from.*['"].*['"];?\s*/g, '');
        
        // Sanitize and escape the component code to prevent JavaScript injection and regex errors
        componentCode = sanitizeComponentCode(componentCode);
        
        console.log('Final componentCode for iframe injection:', componentCode.substring(0, 300));
        
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
                // Make React hooks and utilities available globally  
                window.React = React;
                window.useState = React.useState;
                window.useEffect = React.useEffect;
                window.useContext = React.useContext;
                window.useReducer = React.useReducer;
                window.useCallback = React.useCallback;
                window.useMemo = React.useMemo;
                window.useRef = React.useRef;
                window.useImperativeHandle = React.useImperativeHandle;
                window.useLayoutEffect = React.useLayoutEffect;
                window.useDebugValue = React.useDebugValue;
                
                // Make React functions available
                window.createElement = React.createElement;
                window.Component = React.Component;
                window.PureComponent = React.PureComponent;
                window.Fragment = React.Fragment;
                
                // Wrap component execution in try-catch to prevent regex and other errors
                let componentExecutionSuccess = false;
                try {
                  // Execute the component code in global scope
                  ${componentCode}
                  componentExecutionSuccess = true;
                } catch (codeError) {
                  console.error('Component code execution error:', codeError);
                  // Create a fallback error component
                  window.ErrorFallback = function() {
                    return React.createElement('div', {
                      style: { 
                        padding: '20px', 
                        backgroundColor: '#fef2f2', 
                        border: '1px solid #fecaca', 
                        borderRadius: '8px',
                        color: '#dc2626',
                        fontFamily: 'system-ui'
                      }
                    }, 
                      React.createElement('h3', null, 'Preview Error'),
                      React.createElement('p', null, 'There was an error in the generated code that prevents preview rendering.'),
                      React.createElement('details', null,
                        React.createElement('summary', null, 'Error Details'),
                        React.createElement('pre', { style: { fontSize: '12px', marginTop: '10px' } }, codeError.message)
                      )
                    );
                  };
                }
                
                // Enhanced component detection and rendering
                let ComponentToRender;
                let componentName;
                
                if (componentExecutionSuccess) {
                  // Look for various component patterns
                  const patterns = [
                    /(?:function|const|let|var)\\s+(\\w+)/g,
                    /const\\s+(\\w+)\\s*=\\s*\\(.*?\\)\\s*=>/g,
                    /const\\s+(\\w+)\\s*=\\s*function/g
                  ];
                  
                  for (let pattern of patterns) {
                    let match;
                    while ((match = pattern.exec(\`${componentCode}\`)) !== null) {
                      const name = match[1];
                      if (name && typeof window[name] === 'function' && name !== 'useState' && name !== 'useEffect') {
                        ComponentToRender = window[name];
                        componentName = name;
                        break;
                      }
                    }
                    if (ComponentToRender) break;
                  }
                }
                
                // Try to render the component
                const root = ReactDOM.createRoot(document.getElementById('root'));
                
                if (ComponentToRender) {
                  console.log('Rendering component:', componentName);
                  root.render(React.createElement(ComponentToRender));
                } else if (window.ErrorFallback) {
                  // Render error fallback if code execution failed
                  root.render(React.createElement(window.ErrorFallback));
                } else {
                  // Enhanced fallback: try to extract and execute JSX directly
                  function FallbackComponent() {
                    try {
                      // Look for JSX return patterns with better regex handling
                      const jsxPatterns = [
                        /return\\s*\\(([\\s\\S]*?)\\)\\s*;?\\s*}?$/,
                        /return\\s*([^;\\n]+);?\\s*}?$/,
                        /=>\\s*\\(([\\s\\S]*?)\\)\\s*;?$/,
                        /=>\\s*([^;\\n]+);?$/
                      ];
                      
                      for (let pattern of jsxPatterns) {
                        try {
                          const match = \`${componentCode}\`.match(pattern);
                          if (match) {
                            const jsxContent = match[1].trim();
                            console.log('Found JSX content:', jsxContent);
                            
                            // Try to evaluate the JSX
                            const result = eval('(' + jsxContent + ')');
                            if (result) return result;
                          }
                        } catch (jsxError) {
                          console.warn('JSX pattern matching error:', jsxError);
                          continue; // Try next pattern
                        }
                      }
                      
                      // If still no luck, show a message
                      return React.createElement('div', {
                        className: 'p-4 bg-yellow-50 border border-yellow-200 rounded'
                      }, 'Preview available - component detected but needs manual rendering. Check the generated code below.');
                      
                    } catch (error) {
                      console.error('Fallback rendering error:', error);
                      return React.createElement('div', {
                        className: 'p-4 bg-red-50 border border-red-200 rounded text-red-700'
                      }, 'Preview Error: ' + error.message);
                    }
                  }
                  
                  root.render(React.createElement(FallbackComponent));
                }
              } catch (error) {
                console.error('Preview error:', error);
                const errorMsg = 'Preview Error: ' + error.message + '\\n\\nGenerated Code:\\n' + \`${componentCode}\`;
                document.getElementById('root').innerHTML = '<div style="padding: 20px; color: #dc2626; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; font-family: system-ui; white-space: pre-wrap; font-size: 14px;">' + errorMsg + '</div>';
              }
            </script>
          </body>
          </html>
        `;
        }
        
        // For HTML/CSS/JS
        if (selectedTech === 'html') {
          // Clean markdown formatting from HTML code
          let cleanedContent = previewContent;
          cleanedContent = cleanedContent.replace(/```(html|css|js|javascript)?\s*\n?/g, '');
          cleanedContent = cleanedContent.replace(/```\s*$/g, '');
          
          return cleanedContent.includes('<!DOCTYPE') ? cleanedContent : `
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
              ${cleanedContent}
            </body>
            </html>
          `;
        }
        
        // For other frameworks, show code as text for now  
        let cleanedContent = previewContent;
        // Remove markdown code blocks for all other frameworks
        cleanedContent = cleanedContent.replace(/```(vue|angular|svelte|tsx|ts|javascript|js)?\s*\n?/g, '');
        cleanedContent = cleanedContent.replace(/```\s*$/g, '');
        
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
              <pre>${cleanedContent.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
            </div>
          </body>
          </html>
        `;
      } catch (error) {
        console.error('Error creating preview HTML:', error);
        return `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <style>
              body { margin: 0; padding: 20px; font-family: system-ui; }
              .error { background: #fee; border: 1px solid #fcc; padding: 20px; border-radius: 8px; color: #c00; }
            </style>
          </head>
          <body>
            <div class="error">
              <h3>Preview Error</h3>
              <p>There was an error generating the preview: ${error.message}</p>
            </div>
          </body>
          </html>
        `;
      }
    };

    return (
      <div className="bg-white border-2 border-gray-200 rounded-xl overflow-hidden shadow-lg hover:shadow-xl transition-shadow duration-300">
        <div className="bg-gradient-to-r from-indigo-500 to-purple-600 px-6 py-4 border-b flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-3 h-3 bg-red-400 rounded-full"></div>
            <div className="w-3 h-3 bg-yellow-400 rounded-full"></div>
            <div className="w-3 h-3 bg-green-400 rounded-full"></div>
            <span className="text-white font-medium ml-4">Live Preview</span>
          </div>
          <div className="flex space-x-2">
            {PREVIEW_MODES.map(mode => (
              <button
                key={mode.value}
                onClick={() => setPreviewMode(mode.value)}
                className={`px-4 py-2 text-sm rounded-lg font-medium transition-all duration-200 ${
                  previewMode === mode.value
                    ? 'bg-white text-indigo-600 shadow-lg'
                    : 'bg-indigo-400 text-white hover:bg-indigo-300'
                }`}
              >
                {mode.icon} {mode.label}
              </button>
            ))}
          </div>
        </div>
        <div className="p-6 bg-gray-50 min-h-96">
          <div 
            className="bg-white border-2 border-gray-300 rounded-lg mx-auto transition-all duration-300 overflow-hidden shadow-inner"
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

  const LoadingSpinner = ({ message }) => (
    <div className="flex flex-col items-center justify-center p-8">
      <div className="relative">
        <div className="w-16 h-16 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
        <div className="absolute inset-0 w-16 h-16 border-4 border-transparent border-r-purple-600 rounded-full animate-spin animation-delay-150"></div>
      </div>
      <div className="mt-6 text-center">
        <p className="text-lg font-semibold text-gray-800">{message}</p>
        <p className="text-sm text-gray-500 mt-1">This may take a few seconds...</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50">
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-sm shadow-lg border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                Vision to Code Generator ✨
              </h1>
              <p className="text-gray-600 mt-2">Upload a UI screenshot, add your requirements, and get instant, responsive code</p>
            </div>
            <div className="flex items-center space-x-6">
              <label className="text-sm font-semibold text-gray-700">Framework:</label>
              <select
                value={selectedTech}
                onChange={(e) => setSelectedTech(e.target.value)}
                className="px-4 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white shadow-sm"
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

      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          {/* Upload & Generation Section */}
          <div className="xl:col-span-1 space-y-6">
            {/* Upload Section */}
            <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-200">
              <div className="flex items-center space-x-3 mb-6">
                <div className="w-10 h-10 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-full flex items-center justify-center">
                  <span className="text-white font-bold text-lg">1</span>
                </div>
                <h2 className="text-xl font-bold text-gray-900">Upload Screenshot</h2>
              </div>
              
              {/* Upload Area */}
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                className={`border-3 border-dashed rounded-xl p-8 text-center transition-all duration-300 ${
                  uploadedImage ? 
                    'border-green-400 bg-green-50 shadow-inner' : 
                    'border-gray-300 hover:border-indigo-400 hover:bg-indigo-50 cursor-pointer'
                }`}
              >
                {uploadedImage ? (
                  <div>
                    <img src={uploadedImage} alt="Uploaded" className="max-w-full h-48 object-contain mx-auto mb-4 rounded-lg shadow-md" />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="text-indigo-600 hover:text-indigo-800 font-semibold text-sm"
                    >
                      Upload Different Image
                    </button>
                  </div>
                ) : (
                  <div>
                    <div className="w-16 h-16 mx-auto mb-4 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-full flex items-center justify-center">
                      <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <p className="text-lg font-medium text-gray-800 mb-2">
                      Drop your screenshot here
                    </p>
                    <p className="text-sm text-gray-600">
                      or{" "}
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="text-indigo-600 hover:text-indigo-800 font-semibold underline"
                      >
                        click to browse
                      </button>
                    </p>
                    <p className="text-xs text-gray-500 mt-3">PNG, JPG, SVG up to 10MB</p>
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
            </div>

            {/* Comments Section */}
            {uploadedImage && (
              <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-200">
                <div className="flex items-center space-x-3 mb-6">
                  <div className="w-10 h-10 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-full flex items-center justify-center">
                    <span className="text-white font-bold text-lg">2</span>
                  </div>
                  <h2 className="text-xl font-bold text-gray-900">Add Instructions</h2>
                </div>
                
                <textarea
                  value={userComments}
                  onChange={(e) => setUserComments(e.target.value)}
                  placeholder="Describe your requirements... (e.g., 'Make the navbar sticky', 'Use blue color scheme', 'Add hover effects to buttons')"
                  className="w-full h-32 p-4 border-2 border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 placeholder-gray-400"
                />
                <p className="text-xs text-gray-500 mt-2">Optional but helps generate better code tailored to your needs</p>
              </div>
            )}

            {/* Generate Button */}
            {uploadedImage && (
              <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-200">
                <div className="flex items-center space-x-3 mb-6">
                  <div className="w-10 h-10 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-full flex items-center justify-center">
                    <span className="text-white font-bold text-lg">3</span>
                  </div>
                  <h2 className="text-xl font-bold text-gray-900">Generate Code</h2>
                </div>

                {isGenerating ? (
                  <LoadingSpinner message={`Generating ${selectedTech} code...`} />
                ) : (
                  <button
                    onClick={handleGenerateCode}
                    disabled={!uploadedFile}
                    className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-4 px-6 rounded-xl font-bold text-lg hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-lg hover:shadow-xl transform hover:scale-105"
                  >
                    <div className="flex items-center justify-center space-x-2">
                      <span>✨ Generate {selectedTech.charAt(0).toUpperCase() + selectedTech.slice(1)} Code</span>
                    </div>
                  </button>
                )}

                {/* Selected tech indicator */}
                <div className="mt-4 text-center">
                  <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                    TECHNOLOGIES.find(t => t.value === selectedTech)?.color || 'bg-gray-100 text-gray-800'
                  }`}>
                    {TECHNOLOGIES.find(t => t.value === selectedTech)?.icon} {TECHNOLOGIES.find(t => t.value === selectedTech)?.label}
                  </span>
                </div>
              </div>
            )}

            {/* Chat Section */}
            {sessionId && (
              <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-200">
                <h2 className="text-xl font-bold text-gray-900 mb-6">💬 Feedback & Adjustments</h2>
                
                <div className="h-64 overflow-y-auto mb-6 p-4 bg-gray-50 rounded-xl border">
                  {chatMessages.map((msg, index) => (
                    <div key={index} className={`mb-4 ${msg.type === 'user' ? 'text-right' : 'text-left'}`}>
                      <div className={`inline-block max-w-xs lg:max-w-md px-4 py-3 rounded-xl shadow-sm ${
                        msg.type === 'user'
                          ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white'
                          : 'bg-white text-gray-800 border-2 border-gray-200'
                      }`}>
                        <p className="text-sm">{msg.message}</p>
                      </div>
                    </div>
                  ))}
                  {isChatting && (
                    <div className="text-left">
                      <div className="inline-block bg-gray-200 px-4 py-3 rounded-xl">
                        <div className="flex space-x-1">
                          <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce"></div>
                          <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                          <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <form onSubmit={handleChatSubmit} className="flex space-x-3">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Ask for changes: 'Make button blue', 'Center the header'..."
                    className="flex-1 px-4 py-3 border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    disabled={isChatting}
                  />
                  <button
                    type="submit"
                    disabled={isChatting || !chatInput.trim()}
                    className="px-6 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed font-semibold transition-all duration-200"
                  >
                    Send
                  </button>
                </form>
              </div>
            )}
          </div>

          {/* Preview & Code Section */}
          <div className="xl:col-span-2 space-y-8">
            {generatedCode && renderPreview()}

            {generatedCode && (
              <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-200">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-bold text-gray-900">📝 Generated Code</h2>
                  <button
                    onClick={() => navigator.clipboard.writeText(generatedCode)}
                    className="px-6 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-semibold transition-all duration-200 flex items-center space-x-2"
                  >
                    <span>📋</span>
                    <span>Copy Code</span>
                  </button>
                </div>
                <div className="bg-gray-900 rounded-xl p-6 overflow-x-auto shadow-inner">
                  <pre className="text-green-400 text-sm font-mono leading-relaxed">
                    <code>{generatedCode}</code>
                  </pre>
                </div>
              </div>
            )}

            {!generatedCode && !isGenerating && (
              <div className="bg-white rounded-2xl shadow-xl p-16 text-center border border-gray-200">
                <div className="w-24 h-24 mx-auto mb-6 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-full flex items-center justify-center">
                  <svg className="w-12 h-12 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 className="text-2xl font-bold text-gray-900 mb-3">Ready to Create Magic ✨</h3>
                <p className="text-gray-600 text-lg">Upload a UI screenshot and watch as AI transforms it into responsive, modern code</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;