// Test-process-only provider fixture. Production server never imports this file.
if (process.env.NODE_ENV !== 'test') throw new Error('Vision fixture requires NODE_ENV=test');
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (String(url) !== 'https://api.openai.com/v1/responses') return originalFetch(url, options);
  const body = JSON.parse(options.body);
  if (body.text.format.name !== 'homecare_medication_draft') throw new Error('Medication fixture only');
  const proposal = { medications: [
    { name: '가상약A', strength: '5mg', labelText: '가상약A 5mg · 데모용 포장 글자' },
    { name: '미등록약 <script>window.xss=1</script>', strength: '', labelText: '<img src=x onerror="window.xss=1">' },
  ], confidence: .72 };
  return new Response(JSON.stringify({ status: 'completed', model: 'gpt-4.1-mini', output: [
    {type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(proposal)}]},
  ] }), { status:200, headers:{'Content-Type':'application/json'} });
};
