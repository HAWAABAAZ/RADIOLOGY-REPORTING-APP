import 'dotenv/config';
import express from "express";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import cors from "cors";
import AIService from "aiservice";
import multer from 'multer';
import pkg from '@transcriptionservice/sdk';

import { authenticateDatabase } from './middleware/database-auth.js';
import authRoutes from './routes/database-auth.js';
import templateRoutes from './routes/templates.js';
import feedbackRoutes from './routes/feedback.js';
import analyticsRoutes from './routes/analytics.js';
const { TranscriptionService } = pkg;

const app = express();

// Log all incoming HTTP requests
app.use((req, res, next) => {
  const start = Date.now();
  const { method, originalUrl } = req;
  const origin = req.headers.origin || '-';
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  console.log(`[REQ] ${method} ${originalUrl} origin=${origin} ip=${ip}`);
  res.on('finish', () => {
    const durationMs = Date.now() - start;
    console.log(`[RES] ${method} ${originalUrl} status=${res.statusCode} durationMs=${durationMs}`);
  });
  next();
});

// Configure CORS to allow both local development and production frontend
const corsOptions = {
  origin: [
    'http://localhost:3000', 
    'http://localhost:5173', 
    'http://127.0.0.1:3000', 
    'http://127.0.0.1:5173',
    // Production domains
    'https://www.autoradai.com',
    'https://autoradai.com',
    process.env.FRONTEND_URL,
    // Allow any Vercel deployment domain for this app
    /^https:\/\/.*\.vercel\.app$/
  ].filter(Boolean), // Remove undefined values
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Serve static files (CSS, JS, images)
app.use(express.static('public'));

// Apply JSON parsing only to non-multipart routes
app.use((req, res, next) => {
  // Skip JSON parsing for file upload endpoints or if content-type suggests multipart
  const isTranscribeEndpoint = req.path === '/api/transcribe';
  const isMultipart = req.headers['content-type']?.includes('multipart/form-data');
  
  if (isTranscribeEndpoint || isMultipart) {
    // Skip JSON parsing for transcribe endpoint and multipart uploads
    next();
  } else {
    express.json({ limit: '1mb' })(req, res, next);
  }
});

app.get("/", (_, res) => res.send("HTTP server is running ✅"));

app.get("/health", (_, res) => res.json({ 
  ok: true, 
  time: new Date().toISOString(),
  websocket: 'available',
  transcriptionservice_api: process.env.TRANSCRIPTION_SERVICE_API_KEY ? 'configured' : 'missing'
}));
app.get("/api/health", (_, res) => res.json({ 
  ok: true, 
  time: new Date().toISOString(),
  websocket: 'available',
  transcriptionservice_api: process.env.TRANSCRIPTION_SERVICE_API_KEY ? 'configured' : 'missing'
}));



// Mount authentication routes
app.use('/api/auth', authRoutes);

// Mount template routes
app.use('/api/templates', templateRoutes);

// Mount feedback routes
app.use('/api/feedback', feedbackRoutes);

// Mount analytics routes
app.use('/api/analytics', analyticsRoutes);

// Debug endpoint to test authentication
app.get('/api/auth/test', authenticateDatabase, (req, res) => {
  res.json({
    success: true,
    message: 'Authentication successful',
    user: {
      id: req.user.id,
      email: req.user.email
    }
  });
});

const server = http.createServer(app);

// Configure WebSocket server for Render compatibility
const wss = new WebSocketServer({ 
  noServer: true, // Don't auto-attach to server, we'll handle upgrade manually
  // Add Render-specific configurations
  perMessageDeflate: false,
  maxPayload: 16 * 1024 * 1024, // 16MB max payload
});

// Add explicit upgrade handler for WebSocket connections
server.on('upgrade', (request, socket, head) => {
  console.log('HTTP Upgrade request:', {
    url: request.url,
    headers: request.headers,
    method: request.method
  });
  
  // Check if this is a WebSocket upgrade for our path
  if (request.url.startsWith('/ws')) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      console.log('WebSocket upgrade successful for', request.url);
      wss.emit('connection', ws, request);
    });
  } else {
    console.log('Destroying non-WebSocket upgrade request for', request.url);
    socket.destroy();
  }
});

function heartbeat() { this.isAlive = true; }

// Add WebSocket server error handling
wss.on("error", (error) => {
  console.error("WebSocket Server Error:", error);
});

wss.on("headers", (headers, req) => {
  console.log("WebSocket upgrade headers:", headers);
});

console.log("WebSocket server initialized on path: /ws");

// Helper to convert spoken punctuation into symbols
function applySpokenPunctuation(input) {
  if (!input) return input;
  let text = input;

  const replacements = [
    { re: /\b(full\s+stop|period)\b/gi, rep: '.' },
    { re: /\b(comma)\b/gi, rep: ',' },
    { re: /\b(question\s*mark|questionmark)\b/gi, rep: '?' },
    { re: /\b(exclamation\s*(mark|point)|exclamationmark)\b/gi, rep: '!' },
    { re: /\b(colon)\b/gi, rep: ':' },
    { re: /\b(semi[-\s]?colon)\b/gi, rep: ';' },
    { re: /\b(new\s+line|newline)\b/gi, rep: '\n' },
    { re: /\b(new\s+paragraph)\b/gi, rep: '\n\n' }
  ];

  for (const { re, rep } of replacements) {
    text = text.replace(re, rep);
  }

  // Normalize spaces around punctuation
  text = text
    .replace(/\s+([.,!?;:])/g, '$1')     // remove space before punctuation
    .replace(/([.,!?;:])(?!\s|\n)/g, '$1 ') // ensure a space after punctuation if not EOL or newline
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return text;
}

// WebSocket test endpoint (now that wss is defined)
app.get('/ws-test', (req, res) => {
  res.json({
    message: 'WebSocket server is running',
    path: '/ws',
    clients: wss.clients.size,
    ready: true
  });
});

wss.on("connection", (ws, req) => {
  console.log("WS client connected from", req.socket.remoteAddress, "url", req.url);
  console.log("WS headers:", req.headers);
  ws.isAlive = true;
  ws.on("pong", heartbeat);

  try { ws._socket?.setNoDelay?.(true); } catch (_) {}

  // Detect mode from query: /ws?mode=stream
  let mode = 'echo';
  let enc = 'opus';
  try {
    const url = new URL(req.url, 'http://localhost');
    mode = url.searchParams.get('mode') || 'echo';
    enc = url.searchParams.get('enc') || 'opus';
    console.log("WS parsed params - mode:", mode, "enc:", enc);
  } catch (parseError) {
    console.error("WS URL parse error:", parseError);
  }

  if (mode === 'stream') {
    if (!process.env.TRANSCRIPTION_SERVICE_API_KEY) {
      ws.send(JSON.stringify({ type: 'error', message: 'TranscriptionService API key not configured' }));
      ws.close();
      return;
    }

    // Direct WebSocket connection to TranscriptionService API as per documentation
    const usePcm = enc === 'pcm16';
    // Optional sample rate override via query (?sr=16000) and punctuation toggle (?punct=true)
    let sr = 48000;
    let punct = 'false';
    try {
      const url = new URL(req.url, 'http://localhost');
      const srParam = parseInt(url.searchParams.get('sr') || '', 10);
      if (!Number.isNaN(srParam) && srParam > 0) sr = srParam;
      const punctParam = url.searchParams.get('punct');
      if (punctParam === 'true') punct = 'true';
    } catch (_) {}

    const dgParams = new URLSearchParams({
      model: 'nova-2-medical',
      language: 'en-US',
      punctuate: punct, // default off; enable with ?punct=true
      interim_results: 'true',
      smart_format: 'false',
      profanity_filter: 'false',
      redact: 'false',
      diarize: 'false',
      multichannel: 'false',
      alternatives: '1',
      numerals: 'true',
      endpointing: '300',
      vad_turnoff: '200',
      utterances: 'true'
    });

    if (usePcm) {
      dgParams.set('encoding', 'linear16');
      dgParams.set('sample_rate', String(sr));
      dgParams.set('channels', '1');
    } else {
      dgParams.set('encoding', 'opus');
      dgParams.set('sample_rate', String(sr));
      dgParams.set('channels', '1');
    }

    const dgUrl = `wss://api.transcriptionservice.com/v1/listen?${dgParams.toString()}`;
    console.log('[DG] Connecting to:', dgUrl);

    // WebSocket is already imported at the top of the file
    const apiKey = process.env.TRANSCRIPTION_SERVICE_API_KEY;
    console.log('[DG] Creating WebSocket with API key present:', !!apiKey);
    console.log('[DG] API key length:', apiKey ? apiKey.length : 0);
    
    const dgWs = new WebSocket(dgUrl, {
      headers: {
        'Authorization': `Token ${apiKey}` // Correct format: Token YOUR_API_KEY
      },
      perMessageDeflate: false
    });

    let dgOpen = false;

    // Set a timeout for TranscriptionService connection (reduced for faster response)
    const dgTimeout = setTimeout(() => {
      console.error('[DG] Connection timeout after 5 seconds');
      if (!dgOpen) {
        dgWs.close();
        ws.close(1011, 'TranscriptionService connection timeout');
      }
    }, 5000);

    dgWs.on('open', () => {
      clearTimeout(dgTimeout);
      dgOpen = true;
      console.log('[DG] Direct WebSocket connection open');
      console.log('[DG] TranscriptionService connection established successfully');
      try { dgWs._socket?.setNoDelay?.(true); } catch (_) {}
      try {
        ws.send(JSON.stringify({ type: 'ready' }));
        console.log('[WS] Sent ready message to client');
      } catch (sendError) {
        console.error('[WS] Failed to send ready message:', sendError);
      }
    });

    dgWs.on('error', (err) => {
      clearTimeout(dgTimeout);
      console.error('[DG] WebSocket error:', err?.message || err);
      console.error('[DG] Full error object:', err);
      try { 
        ws.send(JSON.stringify({ type: 'error', message: `TranscriptionService error: ${err?.message || 'Unknown error'}` })); 
      } catch (sendErr) {
        console.error('[WS] Failed to send error message:', sendErr);
      }
      ws.close(1011, 'TranscriptionService connection failed');
    });

    dgWs.on('close', (code, reason) => {
      console.log('[DG] WebSocket closed:', code, reason?.toString());
      try { ws.send(JSON.stringify({ type: 'done' })); } catch (_) {}
    });

    dgWs.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        if (process.env.DG_DEBUG === '1') {
        console.log('[DG] Raw message type:', data.type);
        }
        if (data.type === 'Results') {
          const alt = data?.channel?.alternatives?.[0];
          const transcript = alt?.transcript || '';
          const isFinal = Boolean(data?.is_final || data?.speech_final);
          if (transcript.trim()) {
            const outText = applySpokenPunctuation(transcript);
            if (process.env.DG_DEBUG === '1') {
            console.log(`[DG] Transcript (${isFinal ? 'final' : 'interim'}):`, transcript);
            }
            try {
              ws.send(JSON.stringify({ 
                type: 'transcript', 
                text: outText, 
                is_final: isFinal 
              }));
            } catch (sendErr) {
              console.error('[DG->WS] Send error:', sendErr);
            }
          }
        }
      } catch (parseError) {
        console.error('[DG] Parse error:', parseError);
      }
    });

    ws.on('message', (chunk, isBinary) => {
      if (!dgOpen) {
        if (process.env.DG_DEBUG === '1') {
        console.log('[WS] Dropping message, DG not ready yet, state:', dgWs.readyState);
        }
        return;
      }
      try {
        if (isBinary || Buffer.isBuffer(chunk)) {
          if (process.env.DG_DEBUG === '1') {
          console.log('[WS->DG] Forwarding audio chunk, size:', chunk.length);
          }
          if (dgWs.readyState === 1) { // WebSocket.OPEN
            dgWs.send(chunk);
          } else {
            console.error('[WS->DG] TranscriptionService WebSocket not open, state:', dgWs.readyState);
          }
        } else {
          const text = chunk.toString();
          if (process.env.DG_DEBUG === '1') {
          console.log('[WS] Control message:', text);
          }
          if (text === 'FINISH') {
            console.log('[WS] Finishing TranscriptionService connection');
            dgWs.close();
          }
        }
      } catch (e) {
        console.error('[WS->DG] Send error:', e);
        console.error('[WS->DG] TranscriptionService state during error:', dgWs.readyState);
      }
    });

    ws.on('close', () => {
      try { dgWs.close(); } catch (_) {}
      console.log('WS (stream) closed');
    });
    ws.on('error', (e) => console.error('WS (stream) error:', e));
    return;
  }

  // Default echo mode
  ws.send(JSON.stringify({ type: 'welcome', msg: 'Hello from WS backend' }));
  ws.on('message', (buf) => {
    const text = buf.toString();
    ws.send(JSON.stringify({ type: 'echo', msg: text }));
  });
  ws.on('close', () => console.log('WS closed'));
  ws.on('error', (e) => console.error('WS error:', e));
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 30000);

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => console.log("HTTP+WS listening on", PORT, "and accessible via web"));

// AIService client
const aiservice = new AIService({ apiKey: process.env.AI_SERVICE_API_KEY });

// Note: Old TypeScript system removed - using simplified approach

// Report generation endpoint (requires authentication)
app.post('/api/generate-report', authenticateDatabase, async (req, res) => {
  try {
    const {
      prompt,
      scan_name,
      template_id = "",
      findings_raw,
      findings,
      template_content = null,
      comparison = null,
      clinical_history = null,
      simulate_clinical_questions = false,
      include_advice = false,
      include_questions = false,
      include_differential = false,
      generation_mode = 'espresso'
    } = req.body || {};

    // Use findings_raw if provided, otherwise fall back to findings
    const actualFindings = findings_raw || findings;
    
    // Debug: Log template content to verify it's being received
    console.log('DEBUG - Template content received:', template_content ? 'YES' : 'NO');
    if (template_content) {
      console.log('Template content preview:', template_content.substring(0, 100) + '...');
    }
    

    
    // Extract scan name exactly as written in first line
    function extractScanNameFromFirstLine(text) {
      try {
        if (!text) return null;
        const firstLine = (text.split('\n')[0] || '').trim();
        if (!firstLine) return null;
        
        // Return the first line exactly as written (no processing)
        return firstLine;
        
      } catch (_) { 
        return null; 
      }
    }

    // Enhanced scan name extraction with findings cleanup
    let actualScanName = scan_name;
    let cleanedFindings = actualFindings;
    
    if (!actualScanName) {
      // Priority 1: Try template first (highest priority)
      if (template_content) {
        console.log('DEBUG - Template content first line:', template_content.split('\n')[0]);
        actualScanName = extractScanNameFromFirstLine(template_content);
        console.log('DEBUG - Template scan name extracted:', actualScanName);
      } else {
        console.log('DEBUG - No template content received');
      }
      
      // Priority 2: If no template or no scan name from template, try findings
      if (!actualScanName && actualFindings) {
        actualScanName = extractScanNameFromFirstLine(actualFindings);
        console.log('DEBUG - Findings scan name extracted:', actualScanName);
        
        // If we extracted scan name from findings, remove that line from findings
        if (actualScanName) {
          const firstLine = (actualFindings.split('\n')[0] || '').trim();
          // Check if first line contains explicit modality (CT, MRI, etc.)
          const hasExplicitModality = /^\s*(ct|mri|usg|x-ray|cxr|pet)\s+/i.test(firstLine);
          
          if (hasExplicitModality) {
            // Remove the first line (scan name) from findings
            const lines = actualFindings.split('\n');
            lines.shift(); // Remove first line
            cleanedFindings = lines.join('\n').trim();
            console.log('DEBUG - Removed scan name line from findings:', firstLine);
          }
        }
      }
      
      // Final fallback
      if (!actualScanName) {
        actualScanName = "Radiology Report";
      }
    }
    
    console.log('DEBUG - Final scan name being sent to AI:', actualScanName);

    // Resolve include flags
    const includeAdviceFlag = include_advice === true;
    const includeQuestionsFlag = include_questions === true;
    const includeDifferentialFlag = include_differential === true;
    
    console.log('🔍 Backend received flags:', {
        include_advice: include_advice,
        include_questions: include_questions,
        include_differential: include_differential,
        resolved: { includeAdviceFlag, includeQuestionsFlag, includeDifferentialFlag }
    });

    // Generate structured report using AIService directly
    if (actualFindings) {
        try {
            // Create a comprehensive prompt for structured report generation
            // Generate different prompts based on generation mode
        const isSlowBrewed = generation_mode === 'slow_brewed';
        
            // Simple approach: Always ask AI for everything, but tell it what to exclude
            const reportPrompt = `You are an expert radiologist. Generate a detailed radiology report based on the following clinical history and findings.

${!includeAdviceFlag ? '🚫 DO NOT include clinical_advice field - user did not request clinical advice.' : ''}
${!includeQuestionsFlag ? '🚫 DO NOT include clinician_questions field - user did not request clinician questions.' : ''}
${!includeDifferentialFlag ? '🚫 DO NOT include differential_diagnosis field - user did not request differential diagnosis.' : ''}

REPORTING STYLE:
- Write like a senior consultant radiologist with 20+ years of experience
- Follow the provided template style exactly when present
- Provide comprehensive, detailed descriptions of all findings
- Use precise radiological terminology and measurements
- Include detailed anatomical descriptions and spatial relationships
- Provide thorough differential considerations
- Include detailed technical observations and image quality assessment

CLINICAL HISTORY:
${clinical_history || 'NA'}

${comparison ? `COMPARISON STUDY:
${comparison}

` : ''}FINDINGS:
${cleanedFindings}

THIS IS A ${actualScanName.toUpperCase()} SCAN - GENERATE REPORT FOR THIS SPECIFIC SCAN TYPE

${template_content ? `TEMPLATE TO FOLLOW (CRITICAL - THIS IS YOUR PRIMARY INSTRUCTION):
${template_content}

RADIOLOGIST BEHAVIOR WITH TEMPLATES:
1. USE TEMPLATE SCAN NAME: The scan type above is extracted from template first line - MUST use this exact scan type
2. CLINICAL INTEGRATION: Combine template normal findings with user's positive findings
3. NARRATIVE STYLE: Write as one flowing radiologist narrative, not separate sections
4. TEMPLATE COMPLIANCE: Use template's exact phrasing for normal findings
5. ADAPTATION RULE: Modify template normals to work with positives
   Example: Template "No fracture" + User "C7 fracture" = "Fracture at C7 vertebra. No fracture at other levels."

MANDATORY INTEGRATION PROCESS:
- Start with user's positive findings (abnormalities first)
- Add ALL template normal findings in same paragraph
- Modify template language to avoid contradictions
- Write as experienced radiologist would dictate


EXACT INTEGRATION EXAMPLE:
Template: "Alignment is anatomic. No evidence of acute fracture or dislocation. Vertebral body heights are maintained. Degenerative disc disease and facet arthropathy noted at multiple levels."
User Input: "There is a fracture identified at the C7 vertebra"
REQUIRED OUTPUT: "There is a fracture identified at the C7 vertebra. Alignment is otherwise anatomic. No evidence of acute fracture or dislocation at other levels. Vertebral body heights are maintained. Degenerative disc disease and facet arthropathy noted at multiple levels."

SCAN NAME EXTRACTION: "${template_content ? template_content.split('\n')[0] : actualScanName}"

` : `STANDARD RADIOLOGIST BEHAVIOR:
Generate a structured radiology report with these sections:`}

EXPERT RADIOLOGIST BEHAVIOR (MANDATORY):
1. CLINICAL REASONING: Consider clinical context, patient history, and imaging protocol
2. DIAGNOSTIC ACCURACY: Use precise anatomical terminology and measurements
3. SYSTEMATIC APPROACH: Evaluate all relevant structures systematically
4. SAFETY FOCUS: Identify and clearly state critical or urgent findings
5. CONSISTENCY RULE: Never contradict yourself within same organ system

7. DIFFERENTIAL THINKING: Consider multiple diagnostic possibilities
8. CLINICAL CORRELATION: Recommend appropriate follow-up or additional studies

CONTRADICTION PREVENTION (CRITICAL):
- If you mention an abnormality in an organ, do NOT say that organ is "normal"
- Example: If "cardiomegaly noted" then do NOT say "heart size normal"
- Example: If "liver lesions present" then do NOT say "liver unremarkable"
- Be internally consistent within each organ system

REPORTING STANDARDS:
- Abnormal findings FIRST, then normal findings
- Use standard radiological terminology
- Include measurements when relevant
- Describe anatomical relationships

${template_content ? `
FORMAT AS JSON WITH STANDARD RADIOLOGY SECTIONS:
{
  "technique": "Standard imaging protocol description",
  "comparison": "${comparison ? 'Systematic comparison with prior study' : 'No previous exam available for comparison.'}",
  "findings": "INTEGRATE TEMPLATE CONTENT HERE - combine user findings with template normals in one narrative paragraph",
  "impression": "Clinical impression based on findings",
  "clinical_advice": "Recommendations for follow-up or treatment",
  "clinician_questions": ["5 relevant questions a referring physician might ask"],
  "differential_diagnosis": [
    {"diagnosis": "Most likely diagnosis", "reasoning": "Supporting evidence"},
    {"diagnosis": "Alternative diagnosis", "reasoning": "Why this is possible"},
    {"diagnosis": "Third consideration", "reasoning": "Less likely but important to consider"}
  ]
}` : `
FORMAT AS JSON WITH THESE SECTIONS:
{
  "technique": "${isSlowBrewed ? 'Detailed technique with technical parameters' : 'Brief technique description'}",
  "comparison": "${comparison ? 'Systematic comparison with prior study' : 'No previous exam available for comparison.'}",
  "findings": "${isSlowBrewed ? 'Comprehensive systematic findings with detailed descriptions' : 'Detailed findings with abnormalities first'}",
  "impression": "${isSlowBrewed ? 'Comprehensive clinical impression with reasoning' : 'Clinical impression'}",
  "clinical_advice": "${isSlowBrewed ? 'Detailed recommendations and follow-up plan' : 'Clinical recommendations'}",
  "clinician_questions": ["Question 1", "Question 2", "Question 3", "Question 4", "Question 5"],
  "differential_diagnosis": [
    {"diagnosis": "Diagnosis 1", "reasoning": "${isSlowBrewed ? 'Detailed reasoning with evidence' : 'Why this is possible'}"},
    {"diagnosis": "Diagnosis 2", "reasoning": "${isSlowBrewed ? 'Detailed reasoning with evidence' : 'Why this is possible'}"},
    {"diagnosis": "Diagnosis 3", "reasoning": "${isSlowBrewed ? 'Detailed reasoning with evidence' : 'Why this is possible'}"}${isSlowBrewed ? ',\n    {"diagnosis": "Diagnosis 4", "reasoning": "Additional consideration"},\n    {"diagnosis": "Diagnosis 5", "reasoning": "Final consideration"}' : ''}
  ]
}`}

CRITICAL REMINDERS:
- NEVER create a section or heading called "Pertinent Negatives" or any variation
- DO NOT use these forbidden headings: "Pertinent Negatives:", "Notable Negatives:", "Relevant Negatives:"
- Write findings as ONE continuous narrative without subsections
- Ensure internal consistency - no contradictory statements
- Follow template style exactly when template is provided
- Extract scan name from template first line when available

FORBIDDEN OUTPUT PATTERNS:
- "Pertinent Negatives: [list]"
- Any heading followed by a list of negative findings
- Separate sections for negative findings within the findings field
`;

            // Select models based on generation_mode with safe fallbacks
            const primaryModel = generation_mode === 'slow_brewed' ? 'o3' : 'gpt-5';
            const fallbackModel = generation_mode === 'slow_brewed' ? 'gpt-4o' : 'gpt-4o-mini';
            const temperature = generation_mode === 'slow_brewed' ? 0.1 : 0.3;
            console.log(`[AI] Report generation: mode=${generation_mode} primary=${primaryModel} fallback=${fallbackModel} temp=${temperature}`);
            console.log('DEBUG - Prompt preview (first 500 chars):', reportPrompt.substring(0, 500) + '...');
            console.log('DEBUG - Template mode active:', template_content ? 'YES' : 'NO');

            let response;
            try {
              response = await aiservice.chat.completions.create({
                model: primaryModel,
                messages: [
                    { role: 'system', content: 'You are an expert radiologist generating structured reports. Always respond with valid JSON.' },
                    { role: 'user', content: reportPrompt }
                ],
                temperature,
                max_tokens: 2000,
                response_format: { type: "json_object" }
            });
            } catch (primaryErr) {
              console.warn(`[AI] Primary model failed (${primaryModel}). Falling back to ${fallbackModel}:`, primaryErr?.message || primaryErr);
              response = await aiservice.chat.completions.create({
                model: fallbackModel,
                messages: [
                  { role: 'system', content: 'You are an expert radiologist generating structured reports. Always respond with valid JSON.' },
                  { role: 'user', content: reportPrompt }
                ],
                temperature,
                max_tokens: 2000,
                response_format: { type: "json_object" }
              });
            }

            const reportData = JSON.parse(response.choices[0].message.content);
            
            // Log what the AI returned
            console.log('🔍 AI returned fields:', Object.keys(reportData));
            console.log('🎯 User requested - Advice:', includeAdviceFlag, 'Questions:', includeQuestionsFlag, 'Differential:', includeDifferentialFlag);
            
            // Clean up - AI should have followed instructions, but double-check
            if (!includeAdviceFlag && reportData.clinical_advice) {
                delete reportData.clinical_advice;
                console.log('🔍 Removed clinical_advice (AI ignored instruction)');
            }
            if (!includeQuestionsFlag && reportData.clinician_questions) {
                delete reportData.clinician_questions;
                console.log('🔍 Removed clinician_questions (AI ignored instruction)');
            }
            if (!includeDifferentialFlag && reportData.differential_diagnosis) {
                delete reportData.differential_diagnosis;
                console.log('🔍 Removed differential_diagnosis (AI ignored instruction)');
            }
            console.log('🔍 Final fields after cleanup:', Object.keys(reportData));
            
            // Helper to remove conflicting normal statements when abnormalities are present
            function cleanConflictingNormals(findingsText) {
              try {
                if (!findingsText) return findingsText;
                const text = findingsText.replace(/\s+\n/g, '\n').replace(/\n\s+/g, '\n');

                // Split into sentences conservatively
                const sentences = text
                  .replace(/\n+/g, ' ') // merge lines
                  .split(/(?<=[.?!])\s+/);

                const organs = [
                  'liver', 'hepatic', 'gallbladder', 'biliary', 'pancreas', 'spleen', 'kidney', 'kidneys', 'adrenal', 'stomach',
                  'small bowel', 'colon', 'appendix', 'mesentery', 'peritoneum', 'retroperitoneum', 'bladder', 'uterus', 'ovary', 'ovaries',
                  'prostate', 'seminal vesicles', 'lungs', 'lung', 'pleura', 'mediastinum', 'heart', 'brain', 'cerebellum', 'spine', 'bones',
                  'lymph node', 'lymph nodes', 'vasculature', 'aorta', 'portal vein', 'bile duct'
                ];

                const abnormalHints = [
                  'lesion', 'mass', 'nodule', 'cyst', 'metast', 'enlarg', 'thicken', 'dilat', 'obstruct', 'stone', 'edema', 'infarct',
                  'hemorr', 'aneurysm', 'effusion', 'opacity', 'consolidation', 'fracture', 'lytic', 'sclerotic', 'tear', 'stricture',
                  'cardiomegaly', 'cardiomegali', 'enlarged heart', 'heart enlarg', 'increased heart size', 'cardiac enlarg'
                ];

                const normalHints = [
                  'normal', 'unremarkable', 'no focal', 'no significant', 'without abnormal', 'no evidence of', 'within normal limits',
                  'heart size is normal', 'heart size within normal', 'normal heart size', 'normal cardiac size'
                ];

                // Determine organs with abnormalities mentioned
                const abnormalOrgans = new Set();
                for (const s of sentences) {
                  const low = s.toLowerCase();
                  for (const organ of organs) {
                    if (low.includes(organ)) {
                      for (const hint of abnormalHints) {
                        if (low.includes(hint)) {
                          abnormalOrgans.add(organ);
                          break;
                        }
                      }
                    }
                  }
                }

                // Filter out normal statements for those organs
                const cleaned = sentences.filter(s => {
                  const low = s.toLowerCase();
                  // keep sentence if it is not a normal line for an abnormal organ
                  for (const organ of abnormalOrgans) {
                    if (low.includes(organ)) {
                      for (const normal of normalHints) {
                        if (low.includes(normal)) {
                          return false; // drop conflicting normal line
                        }
                      }
                    }
                  }
                  return true;
                });

                return cleaned.join(' ');
              } catch (_) {
                return findingsText;
              }
            }

            // Clean findings for contradictions
            const aiCleanedFindings = cleanConflictingNormals(reportData.findings);


            const cleanedFindingsNoPN = aiCleanedFindings;

            // Create HTML report with all required sections
            const reportHtml = `
                <div class="report">
                    <h1>${actualScanName}</h1>
                    <div class="history">
                        <h2>Clinical History</h2>
                        ${clinical_history ? clinical_history : 'NA'}
                    </div>
                    <div class="technique">
                        <h2>Technique</h2>
                        ${reportData.technique || 'Standard imaging protocol was performed.'}
                    </div>
                    <div class="comparison">
                        <h2>Comparison</h2>
                        ${reportData.comparison || 'No previous exam available for comparison.'}
                    </div>
                    <div class="findings">
                        <h2>Findings</h2>
                        ${cleanedFindingsNoPN || reportData.findings || aiCleanedFindings}
                    </div>
                    <div class="impression">
                        <h2>Impression</h2>
                        ${reportData.impression || 'No specific impression provided.'}
                    </div>
                    ${includeAdviceFlag ? `
                    <div class="clinical-advice">
                        <h2>Clinical Advice and Safety Considerations</h2>
                        ${reportData.clinical_advice || 'No clinical advice provided.'}
                    </div>` : ''}
                    ${includeQuestionsFlag ? `
                    <div class="clinician-questions">
                        <h2>Clinician Simulation Questions</h2>
                        ${Array.isArray(reportData.clinician_questions) && reportData.clinician_questions.length > 0 ? `
                        <ol>
                            ${reportData.clinician_questions.map(q => `<li>${q}</li>`).join('')}
                        </ol>` : '<p>No clinician questions provided.</p>'}
                    </div>` : ''}
                    ${includeDifferentialFlag ? `
                    <div class="differential-diagnosis">
                        <h2>Differential Diagnosis</h2>
                        ${Array.isArray(reportData.differential_diagnosis) && reportData.differential_diagnosis.length > 0 ? `
                        ${reportData.differential_diagnosis.map((dd, idx) => `
                            <div class="differential-item">
                                <strong>${idx + 1}. ${dd.diagnosis}</strong>
                                <p>${dd.reasoning}</p>
                            </div>
                        `).join('')}` : '<p>No differential diagnoses provided.</p>'}
                    </div>` : ''}
                </div>
            `;

            // Create compatible response
            const compatibleReport = {
                scan_name: actualScanName,
                findings: cleanedFindingsNoPN || reportData.findings,
                impression: reportData.impression,
                technique: reportData.technique,
                ...(includeAdviceFlag ? { clinical_advice: reportData.clinical_advice || '' } : {}),
                ...(includeQuestionsFlag ? { clinician_questions: Array.isArray(reportData.clinician_questions) ? reportData.clinician_questions : [] } : {}),
                ...(includeDifferentialFlag ? { differential_diagnosis: Array.isArray(reportData.differential_diagnosis) ? reportData.differential_diagnosis : [] } : {})
            };

            return res.json({ 
                reportHtml, 
                impressionText: reportData.impression,
                structuredData: compatibleReport,
                text: `${reportData.technique}\n\n${cleanedFindings || reportData.findings}\n\n${reportData.impression}`,
                report: compatibleReport
            });

        } catch (error) {
            console.error('Error generating structured report:', error);
            return res.status(500).json({ error: 'Failed to generate structured report: ' + error.message });
        }
    }

    // Plain mode: require prompt
    if (!prompt) return res.status(400).json({ error: 'Either provide findings OR prompt is required' });

    const messages = [
      { role: 'system', content: 'You are a helpful assistant that generates reports. Return your response as JSON with two fields: reportHtml (HTML content) and impressionText (summary text).' },
      { role: 'user', content: prompt }
    ];

    // Apply same model mapping for plain prompt mode
    const primaryModel = generation_mode === 'slow_brewed' ? 'o3' : 'gpt-5';
    const fallbackModel = generation_mode === 'slow_brewed' ? 'gpt-4o' : 'gpt-4o-mini';
    const temperature = generation_mode === 'slow_brewed' ? 0.1 : 0.3;

    async function getCompletion(model) {
      const resp = await aiservice.chat.completions.create({
        model,
        messages,
        temperature,
        max_tokens: 1000,
        response_format: { type: "json_object" }
      });
      return resp.choices?.[0]?.message?.content || '';
    }

    let text = '';
    try {
      console.log(`[AI] Using primary model for plain mode: ${primaryModel} (mode=${generation_mode})`);
      text = await getCompletion(primaryModel);
    } catch (err) {
      console.error(`[AI] Primary model failed (${primaryModel}). Falling back to ${fallbackModel}:`, err?.response?.data || err?.message || err);
      text = await getCompletion(fallbackModel);
    }

    try {
      const parsed = JSON.parse(text);
      if (parsed.reportHtml && parsed.impressionText) {
        return res.json(parsed);
      }
    } catch (_) {}

    const reportHtml = `<div class="report"><h2>Generated Report</h2><p>${text.replace(/\n/g, '</p><p>')}</p></div>`;
    const impressionText = text.split('\n')[0] || (text.substring(0, 160) + '...');

    res.json({ reportHtml, impressionText });
  } catch (e) {
    console.error('AIService error:', e?.response?.data || e?.message || e);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});



// NEW: Add this analyze-report endpoint
app.post('/api/analyze-report', authenticateDatabase, async (req, res) => {
  try {
    const { reportContent } = req.body;

    if (!reportContent) {
      return res.status(400).json({ error: 'reportContent is required' });
    }

    // Construct a prompt for the AIService API
    const analysisPrompt = `
      Analyze the following radiology report. Based on the report, provide:
      1.  A "whatNotToMiss" array of critical findings that should not be overlooked.
      2.  A "differentials" array with the top 3 differential diagnoses, including why each fits and why it might not fit.
      
      Report Content:
      ${reportContent}
    `;

    const messages = [
      { role: 'system', content: 'You are an expert radiologist providing clinical analysis. Return your response as a JSON object with two keys: "whatNotToMiss" and "differentials".' },
      { role: 'user', content: analysisPrompt }
    ];

    const response = await aiservice.chat.completions.create({
      model: 'gpt-4o',
      messages,
      response_format: { type: 'json_object' }
    });

    const analysis = JSON.parse(response.choices[0].message.content);

    res.json({ success: true, analysis });

  } catch (e) {
    console.error('Analysis error:', e?.response?.data || e?.message || e);
    res.status(500).json({ error: 'Failed to analyze report' });
  }
});





// Note: Critical features system removed for simplification

// ===== API REDIRECTS =====
// Configure API redirects for backward compatibility
// Generate report redirect (CRITICAL - DO NOT REMOVE)
app.post('/generate-report', (req, res) => {
  console.log('[REDIRECT] Redirecting /generate-report to /api/generate-report');
  req.url = '/api/generate-report';
  app._router.handle(req, res);
});

// Transcribe redirect (CRITICAL - DO NOT REMOVE)
app.post('/transcribe', (req, res) => {
  console.log('[REDIRECT] Redirecting /transcribe to /api/transcribe');
  req.url = '/api/transcribe';
  app._router.handle(req, res);
});

// Analyze report redirect (CRITICAL - DO NOT REMOVE)
app.post('/analyze-report', (req, res) => {
  console.log('[REDIRECT] Redirecting /analyze-report to /api/analyze-report');
  req.url = '/api/analyze-report';
  app._router.handle(req, res);
});

// Search redirect (CRITICAL - DO NOT REMOVE)
app.post('/search', (req, res) => {
  console.log('[REDIRECT] Redirecting /search to /api/search');
  req.url = '/api/search';
  app._router.handle(req, res);
});

// ===== TRANSCRIPTION ENDPOINT =====
// Configure multer for audio file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept audio formats and video/webm (which browsers often use for audio)
    if (file.mimetype.startsWith('audio/') || file.mimetype === 'video/webm') {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed. Supported types: audio/*, video/webm'), false);
    }
  }
});

// Initialize TranscriptionService only if API key is available
let transcriptionservice = null;
if (process.env.TRANSCRIPTION_SERVICE_API_KEY) {
  try {
    transcriptionservice = new TranscriptionService(process.env.TRANSCRIPTION_SERVICE_API_KEY);
  } catch (error) {
    console.warn('TranscriptionService initialization failed:', error.message);
  }
}

app.post('/api/transcribe', async (req, res, next) => {
  console.log('[TRANSCRIBE] Request received, checking authentication...');
  authenticateDatabase(req, res, next);
}, upload.single('audio'), async (req, res) => {
  try {
    console.log('[TRANSCRIBE] After multer processing:');
    console.log('- req.file:', req.file ? 'Present' : 'Missing');
    console.log('- req.body keys:', Object.keys(req.body || {}));
    console.log('- Content-Type:', req.headers['content-type']);
    console.log('- Content-Length:', req.headers['content-length']);
    
    // Check if audio file was uploaded
    if (!req.file) {
      console.log('[TRANSCRIBE] No file found - returning 400 error');
      return res.status(400).json({ 
        error: 'No audio file provided',
        code: 'NO_AUDIO_FILE'
      });
    }

    // Check if TranscriptionService is available
    if (!transcriptionservice) {
      return res.status(500).json({ 
        error: 'TranscriptionService API key not configured',
        code: 'API_KEY_MISSING'
      });
    }

    // Get audio buffer and metadata
    const audioBuffer = req.file.buffer;
    const mimeType = req.file.mimetype;
    
    // Determine audio format
    let format = 'webm';
    if (mimeType.includes('mp4') || mimeType.includes('m4a')) {
      format = 'mp4';
    } else if (mimeType.includes('wav')) {
      format = 'wav';
    } else if (mimeType.includes('mp3')) {
      format = 'mp3';
    }

    // Get optional parameters
    const language = req.body.language || 'en-US';
    const model = req.body.model || 'nova-2';
    const smartFormat = req.body.smart_format === 'true';
    const punctuate = req.body.punctuate === 'true'; // default off unless explicitly enabled

    console.log(`[TRANSCRIBE] Processing ${format} audio (${audioBuffer.length} bytes)`);

    // Send to TranscriptionService
    const response = await transcriptionservice.transcription.preRecorded(
      { buffer: audioBuffer, mimetype: mimeType },
      {
        model: model,
        language: language,
        smart_format: smartFormat,
        punctuate: punctuate,
        numerals: true,
        interim_results: false,
        endpointing: 200, // End of speech detection
        utterance_end_ms: 1000, // Wait 1 second after last word
      }
    );

    // Extract transcript
    const transcriptRaw = response.results?.channels[0]?.alternatives[0]?.transcript || '';
    const transcript = applySpokenPunctuation(transcriptRaw);
    const confidence = response.results?.channels[0]?.alternatives[0]?.confidence || 0;
    const detectedLanguage = response.metadata?.language || language;
    const duration = response.metadata?.duration || 0;

    console.log(`[TRANSCRIBE] Success: ${transcript.length} chars, confidence: ${confidence}`);

    // Return success response
    res.json({
      text: transcript,
      success: true
    });

  } catch (error) {
    console.error('[TRANSCRIBE] Error:', error);
    
    // Handle specific error types
    if (error.message?.includes('file size')) {
      return res.status(400).json({ 
        error: 'Audio file too large (max 50MB)',
        code: 'FILE_TOO_LARGE'
      });
    }
    
    if (error.message?.includes('Only audio files')) {
      return res.status(400).json({ 
        error: 'Invalid file type. Only audio files allowed. Supported types: audio/*, video/webm',
        code: 'INVALID_FORMAT',
        supportedTypes: ['audio/*', 'video/webm']
      });
    }

    // Handle TranscriptionService API errors
    if (error.response?.data) {
      return res.status(500).json({
        error: 'Transcription service error: ' + error.response.data.error,
        code: 'DEEPGRAM_ERROR',
        details: error.response.data
      });
    }

    // Generic error response with more details
    res.status(500).json({ 
      error: 'Transcription failed: ' + (error.message || 'Unknown error'),
      code: 'TRANSCRIPTION_ERROR',
      type: error.constructor.name,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});



// ===== SEARCH ENDPOINT =====
app.post('/api/search', authenticateDatabase, async (req, res) => {
  try {
    const { query, source, limit = 5, searchEngineId = null } = req.body;
    
    if (!query) {
      return res.status(400).json({ 
        error: 'Query is required',
        code: 'MISSING_QUERY'
      });
    }

    if (!source || (Array.isArray(source) && source.length === 0)) {
      return res.status(400).json({ 
        error: 'At least one source is required. Use "pubmed", "radiopaedia", "google", or ["pubmed", "radiopaedia", "google"]',
        code: 'MISSING_SOURCE'
      });
    }

    let allResults = [];
    const sources = Array.isArray(source) ? source : [source];
    
    // Search all selected sources
    for (const src of sources) {
      try {
        let results = [];
        switch (src.toLowerCase()) {
          case 'pubmed':
            results = await searchPubMed(query, Math.ceil(limit / sources.length));
            break;
          case 'radiopaedia':
            results = await searchRadiopaedia(query, Math.ceil(limit / sources.length));
            break;
          case 'google':
            results = await searchGoogle(query, Math.ceil(limit / sources.length), searchEngineId);
            break;
          default:
            console.warn(`[SEARCH] Unsupported source: ${src}`);
            continue;
        }
        
        // Add source info to results if not already present
        results = results.map(result => ({
          ...result,
          source: result.source || src.toLowerCase(),
          sourceName: result.sourceName || (
            src.toLowerCase() === 'pubmed' ? 'PubMed' : 
            src.toLowerCase() === 'radiopaedia' ? 'Radiopaedia' : 
            src.toLowerCase() === 'google' ? 'Google' : src
          )
        }));
        
        allResults.push(...results);
      } catch (error) {
        console.error(`[SEARCH] Error searching ${src}:`, error);
        // Continue with other sources even if one fails
      }
    }

    // Sort by relevance and limit total results
    allResults.sort((a, b) => (b.relevance || 0) - (a.relevance || 0));
    allResults = allResults.slice(0, limit);

    res.json({
      success: true,
      sources: sources,
      query: query,
      results: allResults,
      count: allResults.length
    });

  } catch (error) {
    console.error('[SEARCH] Error:', error);
    res.status(500).json({ 
      error: 'Search failed: ' + (error.message || 'Unknown error'),
      code: 'SEARCH_ERROR'
    });
  }
});



// Helper function for PubMed search
async function searchPubMed(query, limit) {
  try {
    console.log(`[PUBMED] Searching for: ${query}`);
    
    // PubMed E-utilities API (free, no API key required)
    const baseUrl = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
    const searchUrl = `${baseUrl}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=${limit}&retmode=json&sort=relevance`;
    
    const searchResponse = await fetch(searchUrl);
    if (!searchResponse.ok) {
      throw new Error(`PubMed search failed: ${searchResponse.status}`);
    }
    
    const searchData = await searchResponse.json();
    const pmids = searchData.esearchresult?.idlist || [];
    
    if (pmids.length === 0) {
      return [];
    }
    
    // Get detailed information for each PMID
    const summaryUrl = `${baseUrl}/esummary.fcgi?db=pubmed&id=${pmids.join(',')}&retmode=json`;
    const summaryResponse = await fetch(summaryUrl);
    
    if (!summaryResponse.ok) {
      throw new Error(`PubMed summary failed: ${summaryResponse.status}`);
    }
    
    const summaryData = await summaryResponse.json();
    const results = [];
    
    for (const pmid of pmids) {
      const article = summaryData.result[pmid];
      if (article) {
        results.push({
          id: `pubmed-${pmid}`,
          pmid: pmid,
          title: article.title || 'No title available',
          authors: article.authors?.map(a => a.name).join(', ') || 'Unknown authors',
          journal: article.fulljournalname || 'Unknown journal',
          year: article.pubdate?.split(' ')[0] || 'Unknown year',
          abstract: article.abstract || 'No abstract available',
          url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
          relevance: 0.9 - (results.length * 0.05), // Slight relevance decrease for variety
          doi: article.articleids?.find(id => id.idtype === 'doi')?.value,
          source: 'pubmed',
          sourceName: 'PubMed'
        });
      }
    }
    
    console.log(`[PUBMED] Found ${results.length} results for: ${query}`);
    return results.slice(0, limit);
    
  } catch (error) {
    console.error('[PUBMED] Error:', error);
    
    // Return empty results instead of mock data
    // This allows the frontend to handle the error gracefully
    return [];
  }
}

// Helper function for Google Custom Search
async function searchGoogle(query, limit, searchEngineId = null) {
  try {
    console.log(`[GOOGLE] Searching for: ${query}`);
    
    // Google Custom Search API key and Search Engine ID
    const API_KEY = 'AIzaSyCJFXNxsTLlRZPP78JNwhZdOsm6tgrHK84';
    const SEARCH_ENGINE_ID = searchEngineId || process.env.GOOGLE_SEARCH_ENGINE_ID || ''; 
    
    if (!SEARCH_ENGINE_ID) {
      console.warn('[GOOGLE] Search Engine ID not configured. Please set GOOGLE_SEARCH_ENGINE_ID in your .env file or provide it in the request.');
      return [];
    }
    
    // Google Custom Search API URL
    const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${API_KEY}&cx=${SEARCH_ENGINE_ID}&q=${encodeURIComponent(query)}&num=${limit}`;
    
    console.log(`[GOOGLE] Searching with URL: ${searchUrl}`);
    const response = await fetch(searchUrl);
    
    // Log the response status
    console.log(`[GOOGLE] Response status: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[GOOGLE] Error response: ${errorText}`);
      throw new Error(`Google search failed: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log(`[GOOGLE] Response data:`, JSON.stringify(data, null, 2));
    const results = [];
    
    // Process search results
    if (data.items && Array.isArray(data.items)) {
      for (const item of data.items) {
        results.push({
          id: `google-${item.cacheId || item.link.replace(/[^a-zA-Z0-9]/g, '-')}`,
          title: item.title || 'No title available',
          description: item.snippet || 'No description available',
          url: item.link,
          displayUrl: item.displayLink || item.link,
          category: 'Web',
          relevance: 0.9 - (results.length * 0.05), // Slight relevance decrease for variety
          thumbnailUrl: item.pagemap?.cse_thumbnail?.[0]?.src,
          source: 'google',
          sourceName: 'Google'
        });
      }
    }
    
    console.log(`[GOOGLE] Found ${results.length} results for: ${query}`);
    return results.slice(0, limit);
    
  } catch (error) {
    console.error('[GOOGLE] Error:', error);
    // Return empty results
    return [];
  }
}

// Helper function for Radiopaedia search
async function searchRadiopaedia(query, limit) {
  try {
    console.log(`[RADIOPAEDIA] Searching for: ${query}`);
    
    // Try multiple Radiopaedia search strategies
    let results = [];
    
    // Strategy 1: Direct API search
    try {
      const searchUrl = `https://radiopaedia.org/api/v1/articles/?search=${encodeURIComponent(query)}&limit=${limit}`;
      
      const response = await fetch(searchUrl, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'RadiologyApp/1.0'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        
        if (data && Array.isArray(data)) {
          for (const article of data) {
            results.push({
              id: `radiopaedia-${article.id}`,
              radiopaediaId: article.id,
              title: article.title || 'No title available',
              description: article.description || article.summary || 'No description available',
              url: `https://radiopaedia.org/articles/${article.slug || article.id}`,
              category: article.category?.name || 'Radiology',
              relevance: 0.95 - (results.length * 0.05),
              imageCount: article.image_count || 0,
              caseCount: article.case_count || 0,
              lastUpdated: article.updated_at || article.created_at,
              source: 'radiopaedia',
              sourceName: 'Radiopaedia'
            });
          }
        }
      }
    } catch (apiError) {
      console.log(`[RADIOPAEDIA] API search failed, trying alternative methods:`, apiError.message);
    }
    
    // Strategy 2: If no results from API, try common radiology topics mapping
    if (results.length === 0) {
      console.log(`[RADIOPAEDIA] No API results, trying topic mapping for: ${query}`);
      
      // Map common medical terms to Radiopaedia topics
      const topicMapping = {
        'pneumonia': 'pneumonia',
        'lung cancer': 'lung-cancer',
        'brain tumor': 'brain-tumour',
        'fracture': 'fracture',
        'pulmonary embolism': 'pulmonary-embolism',
        'appendicitis': 'appendicitis',
        'gallstones': 'gallstones',
        'kidney stones': 'renal-calculi',
        'aortic aneurysm': 'aortic-aneurysm',
        'stroke': 'ischaemic-stroke',
        'heart attack': 'myocardial-infarction',
        'breast cancer': 'breast-cancer',
        'colon cancer': 'colorectal-cancer',
        'liver cancer': 'hepatocellular-carcinoma',
        'pancreatic cancer': 'pancreatic-cancer'
      };
      
      // Find matching topics
      const queryLower = query.toLowerCase();
      const matchingTopics = Object.entries(topicMapping)
        .filter(([term, topic]) => 
          queryLower.includes(term) || term.includes(queryLower) || 
          queryLower.includes(topic.replace(/-/g, ' ')) ||
          topic.replace(/-/g, ' ').includes(queryLower)
        )
        .slice(0, limit);
      
      for (const [term, topic] of matchingTopics) {
        results.push({
          id: `radiopaedia-topic-${topic}`,
          title: `${term.charAt(0).toUpperCase() + term.slice(1)} - Radiopaedia.org`,
          description: `Comprehensive radiological information about ${term} including imaging findings, differential diagnosis, and case studies.`,
          url: `https://radiopaedia.org/articles/${topic}`,
          category: 'Radiology',
          relevance: 0.85,
          source: 'radiopaedia',
          sourceName: 'Radiopaedia',
          isTopicMapping: true
        });
      }
    }
    
    // Strategy 3: If still no results, try general radiology categories
    if (results.length === 0) {
      console.log(`[RADIOPAEDIA] No topic matches, trying general categories for: ${query}`);
      
      const generalCategories = [
        'chest', 'abdomen', 'brain', 'spine', 'musculoskeletal', 
        'cardiovascular', 'gastrointestinal', 'genitourinary', 'head-neck'
      ];
      
      const matchingCategories = generalCategories.filter(category => 
        query.toLowerCase().includes(category) || category.includes(query.toLowerCase())
      );
      
      for (const category of matchingCategories.slice(0, limit)) {
        results.push({
          id: `radiopaedia-category-${category}`,
          title: `${category.charAt(0).toUpperCase() + category.slice(1)} Radiology - Radiopaedia.org`,
          description: `Browse ${category} radiology cases, imaging findings, and clinical information.`,
          url: `https://radiopaedia.org/cases?body_part=${category}`,
          category: 'Radiology',
          relevance: 0.75,
          source: 'radiopaedia',
          sourceName: 'Radiopaedia',
          isCategoryMapping: true
        });
      }
    }
    
    console.log(`[RADIOPAEDIA] Found ${results.length} results for: ${query}`);
    return results.slice(0, limit);
    
  } catch (error) {
    console.error('[RADIOPAEDIA] Error:', error);
    
    // Return empty results instead of mock data
    // This allows the frontend to handle the error gracefully
    return [];
  }
}

// Graceful shutdown for nodemon restarts and Ctrl+C
function shutdown(signal) {
  console.log(`Received ${signal}, shutting down gracefully...`);
  try { 
    wss.close(); 
    console.log('WebSocket server closed');
  } catch (e) {}
  
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
  
  // Force exit after 5 seconds if graceful shutdown fails
  setTimeout(() => {
    console.log('Forcing exit...');
    process.exit(1);
  }, 5000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGUSR2', () => { // nodemon restart signal
  console.log('Nodemon restart detected, shutting down...');
  shutdown('SIGUSR2');
});
