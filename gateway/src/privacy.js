// Loaded FIRST by server.js (ES modules evaluate in import order), before onnxruntime-node initialises.
// onnxruntime-node 1.31+ contains Microsoft "1DS" usage telemetry that uploads to mobile.events.data.microsoft.com.
// A CCTV gateway must not send anything to third parties, so telemetry is off unless an operator explicitly
// sets ORT_DISABLE_TELEMETRY=0. (The Docker image also sets ORT_DISABLE_TELEMETRY=1.)
if (process.env.ORT_DISABLE_TELEMETRY !== '0') process.env.ORT_DISABLE_TELEMETRY = '1';
