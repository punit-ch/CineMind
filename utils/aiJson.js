// utils/aiJson.js — Helpers for reading JSON out of model responses

// Pull the first JSON value out of a string (fallback if the model still adds noise)
const parseJSON = (text) => {
  const cleaned = String(text).replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/[\[{][\s\S]*[\]}]/);
    if (!match) throw new SyntaxError('AI returned no JSON');
    return JSON.parse(match[0]);
  }
};

const asArray = (value, key) => {
  if (Array.isArray(value)) return value;
  if (key && Array.isArray(value?.[key])) return value[key];
  throw new SyntaxError('AI response had unexpected shape');
};

module.exports = { parseJSON, asArray };
