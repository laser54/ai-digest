export async function readDigestStream(response, onProgress) {
  if (!response.ok) {
    const body = await response.json();
    throw new Error(body.error);
  }
  if (!response.body) throw new Error('Браузер не поддерживает потоковый ответ AI-отбора.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  let result;
  const handleLine = (line) => {
    if (!line) return;
    const event = JSON.parse(line);
    if (event.type === 'progress') onProgress(event);
    if (event.type === 'error') throw new Error(event.error);
    if (event.type === 'result') result = event;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffered += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffered.split('\n');
      buffered = lines.pop();
      lines.forEach(handleLine);
      if (done) break;
    }
    handleLine(buffered);
  } finally {
    reader.releaseLock();
  }
  if (!result) throw new Error('AI-отбор завершился без результата.');
  return result;
}
