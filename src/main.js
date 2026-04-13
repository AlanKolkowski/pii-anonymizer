import { anonymizeText, deanonymizeText } from './anonymizer.js';
import './style.css';

const worker = new Worker(new URL('./worker.js', import.meta.url), {
  type: 'module',
});

let currentLegend = null;

// --- DOM refs ---
const downloadBtn = document.getElementById('download-btn');
const modelStatus = document.getElementById('model-status');
const inputText = document.getElementById('input-text');
const anonymizeBtn = document.getElementById('anonymize-btn');
const resultSection = document.getElementById('result-section');
const anonymizedOutput = document.getElementById('anonymized-output');
const copyAnonymizedBtn = document.getElementById('copy-anonymized');
const legendTableBody = document.querySelector('#legend-table tbody');
const deanonymizeSection = document.getElementById('deanonymize-section');
const deanonymizeInput = document.getElementById('deanonymize-input');
const deanonymizeBtn = document.getElementById('deanonymize-btn');
const deanonymizeResultSection = document.getElementById(
  'deanonymize-result-section',
);
const deanonymizedOutput = document.getElementById('deanonymized-output');
const copyDeanonymizedBtn = document.getElementById('copy-deanonymized');

// --- Worker message handler ---
worker.onmessage = (e) => {
  const msg = e.data;

  switch (msg.type) {
    case 'progress': {
      const pct = Math.round(msg.progress ?? 0);
      modelStatus.textContent = `Downloading model... ${pct}%`;
      break;
    }
    case 'loaded':
      modelStatus.textContent = 'Model ready.';
      downloadBtn.disabled = true;
      downloadBtn.textContent = 'Model Loaded';
      anonymizeBtn.disabled = false;
      break;
    case 'error':
      modelStatus.textContent = `Error: ${msg.message}`;
      downloadBtn.disabled = false;
      anonymizeBtn.disabled = false;
      anonymizeBtn.textContent = 'Anonymize';
      break;
    case 'result':
      handleAnonymizationResult(msg.data);
      break;
  }
};

// --- Download model ---
downloadBtn.addEventListener('click', () => {
  downloadBtn.disabled = true;
  modelStatus.textContent = 'Initializing...';
  worker.postMessage({ type: 'load' });
});

// --- Anonymize ---
anonymizeBtn.addEventListener('click', () => {
  const text = inputText.value.trim();
  if (!text) return;
  anonymizeBtn.disabled = true;
  anonymizeBtn.textContent = 'Analyzing...';
  worker.postMessage({ type: 'classify', text });
});

function handleAnonymizationResult(entities) {
  const text = inputText.value.trim();
  const { anonymized, legend } = anonymizeText(text, entities);
  currentLegend = legend;

  anonymizedOutput.textContent = anonymized;

  legendTableBody.innerHTML = '';
  for (const [token, value] of Object.entries(legend)) {
    const row = document.createElement('tr');
    const tokenCell = document.createElement('td');
    const code = document.createElement('code');
    code.textContent = token;
    tokenCell.appendChild(code);
    const valueCell = document.createElement('td');
    valueCell.textContent = value;
    row.appendChild(tokenCell);
    row.appendChild(valueCell);
    legendTableBody.appendChild(row);
  }

  resultSection.hidden = false;
  deanonymizeSection.hidden = false;
  deanonymizeResultSection.hidden = true;
  anonymizeBtn.disabled = false;
  anonymizeBtn.textContent = 'Anonymize';
}

// --- Copy anonymized ---
copyAnonymizedBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(anonymizedOutput.textContent);
  copyAnonymizedBtn.textContent = 'Copied!';
  setTimeout(() => {
    copyAnonymizedBtn.textContent = 'Copy to Clipboard';
  }, 2000);
});

// --- De-anonymize ---
deanonymizeBtn.addEventListener('click', () => {
  const text = deanonymizeInput.value.trim();
  if (!text || !currentLegend) return;
  const result = deanonymizeText(text, currentLegend);
  deanonymizedOutput.textContent = result;
  deanonymizeResultSection.hidden = false;
});

// --- Copy de-anonymized ---
copyDeanonymizedBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(deanonymizedOutput.textContent);
  copyDeanonymizedBtn.textContent = 'Copied!';
  setTimeout(() => {
    copyDeanonymizedBtn.textContent = 'Copy to Clipboard';
  }, 2000);
});
