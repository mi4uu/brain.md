console.log("[poc] starting");
console.log("[poc] NODE_PATH=", process.env.NODE_PATH);
try {
  const ort = require("onnxruntime-node");
  console.log("[poc] ✓ loaded onnxruntime-node, keys:", Object.keys(ort).slice(0,5));
} catch (e) {
  console.log("[poc] ✗ require failed:", e instanceof Error ? e.message.slice(0,200) : String(e));
}
