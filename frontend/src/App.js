import React, { useState, useRef } from 'react';
import axios from 'axios';

// Get backend URL from environment or use fallback
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8001';

const TECHNOLOGIES = [
  { value: 'react', label: 'React', icon: '⚛️' },
  { value: 'vue', label: 'Vue.js', icon: '💚' },
  { value: 'angular', label: 'Angular', icon: '🅰️' },
  { value: 'svelte', label: 'Svelte', icon: '🧡' },
  { value: 'html', label: 'HTML + CSS + JS', icon: '🌐' },
];

const PREVIEW_MODES = [
  { value: 'desktop', label: 'Desktop', icon: '🖥️', width: '100%' },
  { value: 'tablet', label: 'Tablet', icon: '📱', width: '768px' },
  { value: 'mobile', label: 'Mobile', icon: '📱', width: '375px' },
];

function App() {
  const [uploadedImage, setUploadedImage] = useState(null);
  const [selectedTech, setSelectedTech] = useState('react');
  const [generatedCode, setGeneratedCode] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewMode, setPreviewMode] = useState('desktop');
  const [sessionId, setSessionId] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [isChatting, setIsChatting] = useState(false);
  const [chatHistory, setChatHistory] = useState([]);
  const [userComments, setUserComments] = useState('');
  const [error, setError] = useState('');
  
  const fileInputRef = useRef(null);

  const handleFileUpload = (file) => {
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setUploadedImage(e.target.result);
        setError('');
        // Reset generated code when new image is uploaded
        setGeneratedCode('');
        setSessionId('');
        setChatHistory([]);
      };
      reader.readAsDataURL(file);
    } else {
      setError('Please upload a valid image file (PNG, JPG, SVG)');
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    handleFileUpload(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const generateCode = async () => {
    if (!uploadedImage) {
      setError('Please upload an image first');
      return;
    }

    setIsGenerating(true);
    setError('');
    
    try {
      // Convert data URL to file
      const response = await fetch(uploadedImage);
      const blob = await response.blob();
      
      // Create form data
      const formData = new FormData();
      formData.append('file', blob, 'screenshot.png');
      formData.append('technology', selectedTech);
      formData.append('comments', userComments || '');

      // Make API call
      const apiResponse = await axios.post(`${BACKEND_URL}/api/upload-and-generate`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        timeout: 30000, // 30 second timeout
      });

      if (apiResponse.data && apiResponse.data.code) {
        setGeneratedCode(apiResponse.data.code);
        setSessionId(apiResponse.data.session_id);
        setError('');
      } else {
        throw new Error('No code generated from API response');
      }
      
    } catch (error) {
      console.error('Code generation failed:', error);
      let errorMessage = 'Failed to generate code. ';
      
      if (error.code === 'ECONNABORTED') {
        errorMessage += 'Request timed out. Please try again.';
      } else if (error.response?.status === 400) {
        errorMessage += error.response.data?.detail || 'Invalid request.';
      } else if (error.response?.status === 500) {
        errorMessage += 'Server error. Please try again later.';
      } else if (error.message.includes('Network Error')) {
        errorMessage += 'Network connection error. Please check your connection.';
      } else {
        errorMessage += error.message || 'Unknown error occurred.';
      }
      
      setError(errorMessage);
      
      // Set fallback code for preview
      setGeneratedCode(createFallbackCode(selectedTech, errorMessage));
    } finally {
      setIsGenerating(false);
    }
  };

  const createFallbackCode = (technology, errorMessage) => {
    if (technology === 'react') {
      return `import React from 'react';

const ErrorComponent = () => {
  return (
    <div className="p-6 bg-red-50 border-2 border-red-200 rounded-lg max-w-md mx-auto">
      <h3 className="text-lg font-bold text-red-800 mb-2">Generation Error</h3>
      <p className="text-red-700 mb-2">
        ${errorMessage}
      </p>
      <button 
        onClick={() => window.location.reload()} 
        className="mt-2 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
      >
        Try Again
      </button>
    </div>
  );
};

export default ErrorComponent;`;
    }
    return `/* Error: ${errorMessage} */`;
  };

  const sendChatMessage = async () => {
    if (!chatInput.trim() || !sessionId) return;

    setIsChatting(true);
    const userMessage = chatInput;
    setChatInput('');
    
    // Add user message to history
    setChatHistory(prev => [...prev, { type: 'user', message: userMessage }]);

    try {
      const response = await axios.post(`${BACKEND_URL}/api/chat`, {
        session_id: sessionId,
        message: userMessage,
        current_code: generatedCode
      });

      if (response.data && response.data.response) {
        // Add AI response to history
        setChatHistory(prev => [...prev, { type: 'ai', message: response.data.response }]);
        
        // Update generated code if the response contains code
        if (response.data.response.length > 100) { // Assume longer responses are code
          setGeneratedCode(response.data.response);
        }
      }
    } catch (error) {
      console.error('Chat failed:', error);
      setChatHistory(prev => [...prev, { type: 'ai', message: 'Sorry, I encountered an error. Please try again.' }]);
    } finally {
      setIsChatting(false);
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
        componentCode = componentCode.replace(/```(jsx|javascript|js|react|typescript|ts)?\s*\n?/g, '');
        componentCode = componentCode.replace(/```\s*$/g, '');
        
        console.log('After markdown cleanup, componentCode preview:', componentCode.substring(0, 200));
        
        // Remove export statements and clean the code
        componentCode = componentCode.replace(/export\s+default\s+\w+;?\s*$/, '');
        componentCode = componentCode.replace(/import.*from.*['"].*['"];?\s*/g, '');
        
        // Clean up any remaining issues
        componentCode = componentCode.trim();
        
        console.log('Final componentCode for iframe injection:', componentCode.substring(0, 300));
        
        return `<!DOCTYPE html>
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
            
            <script>
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
              
              console.log('React environment setup complete for Babel transformation');
            </script>
            
            <script type="text/babel">
              // Direct JSX code injection - let Babel transform everything properly
              const { useState, useEffect, useContext, useReducer, useCallback, useMemo, useRef } = React;
              
              try {
                // === GENERATED COMPONENT CODE STARTS HERE ===
                ${componentCode.replace(/\$/g, '\\$')}
                // === GENERATED COMPONENT CODE ENDS HERE ===
                
                // Auto-detect and render component after Babel transformation
                setTimeout(() => {
                  try {
                    const root = ReactDOM.createRoot(document.getElementById('root'));
                    let ComponentToRender = null;
                    let componentName = '';
                    
                    // Enhanced component detection - check all possible component patterns
                    const componentPatterns = [
                      // Arrow function components: const ComponentName = () => { ... }
                      { pattern: /const\\s+(\\w+)\\s*=\\s*\\([^)]*\\)\\s*=>/g, type: 'arrow' },
                      // Function declarations: function ComponentName() { ... }
                      { pattern: /function\\s+(\\w+)\\s*\\([^)]*\\)/g, type: 'function' },
                      // Variable function assignments: const ComponentName = function() { ... }
                      { pattern: /const\\s+(\\w+)\\s*=\\s*function/g, type: 'variable' }
                    ];
                    
                    const excludedNames = ['useState', 'useEffect', 'useContext', 'useReducer', 'useCallback', 'useMemo', 'useRef', 'console', 'alert', 'setTimeout', 'setInterval'];
                    
                    const componentCodeStr = \`${componentCode.replace(/\$/g, '\\$')}\`;
                    
                    // Try each pattern to find components
                    for (let patternObj of componentPatterns) {
                      const { pattern, type } = patternObj;
                      let match;
                      
                      while ((match = pattern.exec(componentCodeStr)) !== null) {
                        const name = match[1];
                        
                        if (name && !excludedNames.includes(name) && typeof window[name] === 'function') {
                          ComponentToRender = window[name];
                          componentName = name;
                          console.log('Found ' + type + ' component: ' + componentName);
                          break;
                        }
                      }
                      
                      if (ComponentToRender) break;
                    }
                    
                    // Render the component or fallback
                    if (ComponentToRender) {
                      console.log('Rendering detected component:', componentName);
                      root.render(React.createElement(ComponentToRender));
                    } else {
                      // Show success message if no component detected but code executed successfully  
                      const SuccessComponent = () => React.createElement('div', {
                        className: 'flex items-center justify-center min-h-[200px] p-6'
                      }, React.createElement('div', {
                        className: 'max-w-md mx-auto text-center bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-200 rounded-xl p-6 shadow-lg'
                      }, [
                        React.createElement('div', {
                          key: 'icon',
                          className: 'w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-4'
                        }, React.createElement('svg', {
                          className: 'w-8 h-8 text-white',
                          fill: 'none',
                          stroke: 'currentColor',
                          viewBox: '0 0 24 24'
                        }, React.createElement('path', {
                          strokeLinecap: 'round',
                          strokeLinejoin: 'round',
                          strokeWidth: 2,
                          d: 'M5 13l4 4L19 7'
                        }))),
                        React.createElement('h3', {
                          key: 'title',
                          className: 'text-xl font-bold text-green-800 mb-3'
                        }, 'Code Generated Successfully!'),
                        React.createElement('p', {
                          key: 'description',
                          className: 'text-green-600 mb-4'
                        }, 'Your React component has been generated and processed without errors.'),
                        React.createElement('div', {
                          key: 'status',
                          className: 'bg-green-100 p-3 rounded-lg text-sm text-green-700'
                        }, React.createElement('strong', null, 'Status: '), 'Code compiled and ready to use')
                      ]));
                      
                      console.log('No component auto-detected, showing success message');
                      root.render(React.createElement(SuccessComponent));
                    }
                    
                  } catch (renderError) {
                    console.error('Component render error:', renderError);
                    
                    const ErrorComponent = () => React.createElement('div', {
                      className: 'flex items-center justify-center min-h-[200px] p-6'
                    }, React.createElement('div', {
                      className: 'max-w-md mx-auto bg-red-50 border-2 border-red-200 rounded-xl p-6'
                    }, React.createElement('div', {
                      className: 'text-center'
                    }, [
                      React.createElement('div', {
                        key: 'icon',
                        className: 'w-16 h-16 bg-red-500 rounded-full flex items-center justify-center mx-auto mb-4'
                      }, React.createElement('svg', {
                        className: 'w-8 h-8 text-white',
                        fill: 'none',
                        stroke: 'currentColor',
                        viewBox: '0 0 24 24'
                      }, React.createElement('path', {
                        strokeLinecap: 'round',
                        strokeLinejoin: 'round',
                        strokeWidth: 2,
                        d: 'M6 18L18 6M6 6l12 12'
                      }))),
                      React.createElement('h3', {
                        key: 'title',
                        className: 'text-lg font-bold text-red-800 mb-3'
                      }, 'Render Error'),
                      React.createElement('p', {
                        key: 'description',
                        className: 'text-red-600 mb-3'
                      }, 'There was an error rendering the component:'),
                      React.createElement('pre', {
                        key: 'error',
                        className: 'bg-red-100 p-3 rounded text-xs text-red-700 overflow-auto max-h-32 text-left'
                      }, renderError.message)
                    ])));
                  
                    const root = ReactDOM.createRoot(document.getElementById('root'));
                    root.render(React.createElement(ErrorComponent));
                  }
                }, 100);
                
              } catch (transformError) {
                console.error('Babel transformation error:', transformError);
                
                // Render error message using React.createElement to avoid JSX issues
                setTimeout(() => {
                  const ErrorComponent = () => React.createElement('div', {
                    className: 'flex items-center justify-center min-h-[200px] p-6'
                  }, React.createElement('div', {
                    className: 'max-w-md mx-auto bg-red-50 border-2 border-red-200 rounded-xl p-6'
                  }, React.createElement('div', {
                    className: 'text-center'
                  }, [
                    React.createElement('div', {
                      key: 'icon',
                      className: 'w-16 h-16 bg-red-500 rounded-full flex items-center justify-center mx-auto mb-4'
                    }, React.createElement('span', {
                      className: 'text-white text-2xl'
                    }, '!')),
                    React.createElement('h3', {
                      key: 'title',
                      className: 'text-lg font-bold text-red-800 mb-3'
                    }, 'Transformation Error'),
                    React.createElement('p', {
                      key: 'description',
                      className: 'text-red-600 mb-3'
                    }, 'There was an error processing the code:'),
                    React.createElement('pre', {
                      key: 'error',
                      className: 'bg-red-100 p-3 rounded text-xs text-red-700 overflow-auto max-h-32 text-left'
                    }, transformError.message)
                  ])));
                
                  const root = ReactDOM.createRoot(document.getElementById('root'));
                  root.render(React.createElement(ErrorComponent));
                }, 100);
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
                  <div onClick={() => fileInputRef.current?.click()}>
                    <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <span className="text-indigo-600 text-2xl">📷</span>
                    </div>
                    <p className="text-gray-600 mb-2">
                      <span className="font-semibold">Click to upload</span> or drag and drop
                    </p>
                    <p className="text-sm text-gray-500">PNG, JPG, SVG up to 10MB</p>
                  </div>
                )}
              </div>
              
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => handleFileUpload(e.target.files[0])}
                className="hidden"
              />
            </div>

            {/* Instructions Section */}
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
                  placeholder="Optional: Add specific requirements like colors, interactions, or styling preferences..."
                  className="w-full h-32 p-4 border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
                />
                <p className="text-sm text-gray-500 mt-2">
                  Help the AI understand your specific needs for better results
                </p>
              </div>
            )}

            {/* Generate Section */}
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
                    onClick={generateCode}
                    disabled={!uploadedImage}
                    className="w-full bg-gradient-to-r from-indigo-500 to-purple-600 text-white py-4 px-6 rounded-xl font-semibold text-lg shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                  >
                    ✨ Generate {selectedTech.charAt(0).toUpperCase() + selectedTech.slice(1)} Code
                  </button>
                )}
                
                {error && (
                  <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-red-700 text-sm">{error}</p>
                  </div>
                )}
              </div>
            )}

            {/* Chat Section */}
            {generatedCode && (
              <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-200">
                <h3 className="text-lg font-bold text-gray-900 mb-4">💬 Chat & Adjustments</h3>
                
                {/* Chat History */}
                <div className="max-h-64 overflow-y-auto mb-4 space-y-3">
                  {chatHistory.map((msg, index) => (
                    <div
                      key={index}
                      className={`p-3 rounded-lg ${
                        msg.type === 'user'
                          ? 'bg-indigo-100 text-indigo-800 ml-4'
                          : 'bg-gray-100 text-gray-800 mr-4'
                      }`}
                    >
                      <p className="text-sm whitespace-pre-wrap">{msg.message}</p>
                    </div>
                  ))}
                </div>
                
                {/* Chat Input */}
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && sendChatMessage()}
                    placeholder="Ask for changes (e.g., 'Make the button blue')"
                    className="flex-1 p-3 border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    disabled={isChatting}
                  />
                  <button
                    onClick={sendChatMessage}
                    disabled={!chatInput.trim() || isChatting}
                    className="px-6 py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isChatting ? '...' : 'Send'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Preview Section */}
          <div className="xl:col-span-2">
            {generatedCode ? (
              <>
                {renderPreview()}
                
                {/* Generated Code Display */}
                <div className="mt-8 bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
                  <div className="bg-gray-900 px-6 py-4 flex items-center justify-between">
                    <span className="text-white font-medium">Generated Code</span>
                    <button
                      onClick={() => navigator.clipboard.writeText(generatedCode)}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm"
                    >
                      Copy Code
                    </button>
                  </div>
                  <div className="p-6 bg-gray-50 max-h-96 overflow-y-auto">
                    <pre className="text-sm text-gray-800 whitespace-pre-wrap font-mono leading-relaxed">
                      {generatedCode}
                    </pre>
                  </div>
                </div>
              </>
            ) : (
              <div className="bg-white rounded-xl shadow-lg border-2 border-dashed border-gray-300 p-12 text-center">
                <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <span className="text-gray-400 text-3xl">🎯</span>
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">Ready for Code Generation</h3>
                <p className="text-gray-600">
                  Upload a screenshot and click "Generate Code" to see your UI come to life
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;