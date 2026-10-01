const GEMINI_API_URL = GEMINI_API_URL_CONFIG;

const input = document.getElementById("ingredient-input");
const addBtn = document.getElementById("add-btn");
const chipsEl = document.getElementById("chips");
const drop = document.getElementById("drop");
const cameraInput = document.getElementById("camera-input");
const uploadInput = document.getElementById("upload-input");
const previewBox = document.getElementById("preview-box");
const previewImg = document.getElementById("preview");
const removePhotoBtn = document.getElementById("remove-photo");
const generateBtn = document.getElementById("generate-btn");
const statusEl = document.getElementById("status");
const emptyEl = document.getElementById("empty");
const loadingEl = document.getElementById("loading");
const resultEl = document.getElementById("result");

let ingredients = [];     // typed ingredients
let photoBase64 = null;   // photo as base64 (no "data:" prefix)

/* ---------- 1. Manual ingredients ---------- */

function addIngredients(text) {
  text.split(",").forEach((raw) => {
    const item = raw.trim().toLowerCase();
    if (item && !ingredients.includes(item)) ingredients.push(item);
  });
  renderChips();
}

function renderChips() {
  chipsEl.innerHTML = "";
  ingredients.forEach((item, i) => {
    const li = document.createElement("li");
    li.textContent = item;
    const x = document.createElement("button");
    x.type = "button";
    x.textContent = "×";
    x.setAttribute("aria-label", "Remove " + item);
    x.onclick = () => {
      ingredients.splice(i, 1);
      renderChips();
    };
    li.appendChild(x);
    chipsEl.appendChild(li);
  });
}

addBtn.onclick = () => {
  addIngredients(input.value);
  input.value = "";
  input.focus();
};
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    addBtn.click();
  }
});

/* ---------- 2. Photo: shrink it, then convert to base64 ---------- */

function handlePhoto(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      // Shrink so the request stays small and fast (max 1024px side)
      const max = 1024;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      photoBase64 = dataUrl.split(",")[1];
      previewImg.src = dataUrl;
      previewBox.hidden = false;
    };
    img.onerror = () => showStatus("That file couldn't be read as an image. Try a JPG or PNG.", true);
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

cameraInput.onchange = () => handlePhoto(cameraInput.files[0]);
uploadInput.onchange = () => handlePhoto(uploadInput.files[0]);
removePhotoBtn.onclick = () => {
  photoBase64 = null;
  previewBox.hidden = true;
  cameraInput.value = "";
  uploadInput.value = "";
};

// Drop zone: keyboard + drag and drop
drop.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    uploadInput.click();
  }
});
["dragenter", "dragover"].forEach((ev) =>
  drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.add("over");
  })
);
["dragleave", "drop"].forEach((ev) =>
  drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.remove("over");
  })
);
drop.addEventListener("drop", (e) => handlePhoto(e.dataTransfer.files[0]));

/* ---------- 3. Gemini call ---------- */

function buildPrompt() {
  const typed = ingredients.length ? ingredients.join(", ") : "none";
  return `You are a practical home cook.
Ingredients the user typed: ${typed}.
${photoBase64 ? "The attached photo shows more of what they have. List the food items you can clearly see." : "There is no photo."}

Create the single most suitable recipe using mainly these ingredients.
You may assume basic pantry items (salt, pepper, oil, water). Keep extra ingredients to a minimum and mark them with "have": false.

Reply ONLY with JSON in exactly this shape:
{
  "error": "" ,
  "detected_ingredients": ["..."],
  "recipe": {
    "title": "...",
    "time_minutes": 0,
    "servings": 0,
    "ingredients": [{"item": "...", "amount": "...", "have": true}],
    "steps": ["..."]
  }
}
If no food can be identified, set "error" to a short explanation and leave the rest empty.`;
}

async function askGemini() {
  if (!GEMINI_API_URL || GEMINI_API_URL.includes("YOUR-CLOUDFLARE-SUBDOMAIN")) {
    throw new Error("Configure the recipe service URL in config.js before generating a recipe.");
  }

  const parts = [{ text: buildPrompt() }];
  if (photoBase64) {
    parts.push({ inline_data: { mime_type: "image/jpeg", data: photoBase64 } });
  }

  const res = await fetch(GEMINI_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.7 },
    }),
  });

  if (!res.ok) {
    if (res.status === 429) throw new Error("Too many requests right now. Wait a minute and try again.");
    if (res.status === 400 || res.status === 403) throw new Error("The recipe service rejected the request. Check the Worker configuration.");
    throw new Error("Gemini returned an error (" + res.status + "). Try again.");
  }

  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text || "")
    .join("")
    .replace(/```json|```/g, "")
    .trim();
  if (!text) throw new Error("Gemini sent back an empty answer. Try again.");
  return JSON.parse(text);
}

/* ---------- 4. Show the recipe ---------- */

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function setView(name) {
  emptyEl.hidden = name !== "empty";
  loadingEl.hidden = name !== "loading";
  resultEl.hidden = name !== "result";
}

function renderResult(data) {
  const r = data.recipe;
  resultEl.innerHTML = "";

  if (data.detected_ingredients?.length) {
    const found = el("p", undefined, "found");
    found.append(el("strong", "Ingredients found: "), document.createTextNode(data.detected_ingredients.join(", ")));
    resultEl.appendChild(found);
  }

  resultEl.appendChild(el("h3", r.title));
  const pills = el("div", undefined, "pills");
  pills.append(el("span", r.time_minutes + " min", "pill"), el("span", "Serves " + r.servings, "pill"));
  resultEl.appendChild(pills);

  const cols = el("div", undefined, "cols");

  const left = el("div");
  left.appendChild(el("h4", "Ingredients"));
  const ul = el("ul", undefined, "ing");
  r.ingredients.forEach((ing) => {
    const li = el("li", `${ing.amount} ${ing.item}`.trim());
    if (ing.have === false) li.append(el("span", "need to buy", "missing"));
    ul.appendChild(li);
  });
  left.appendChild(ul);

  const right = el("div");
  right.appendChild(el("h4", "Steps"));
  const ol = el("ol", undefined, "steps");
  r.steps.forEach((s) => ol.appendChild(el("li", s)));
  right.appendChild(ol);

  cols.append(left, right);
  resultEl.appendChild(cols);

  setView("result");
  resultEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------- 5. Button + status ---------- */

function showStatus(msg, isError) {
  statusEl.textContent = msg;
  statusEl.className = "status" + (isError ? " error" : "");
}

generateBtn.onclick = async () => {
  addIngredients(input.value); // include anything typed but not yet added
  input.value = "";

  if (!ingredients.length && !photoBase64) {
    showStatus("Add at least one ingredient or a photo first.", true);
    return;
  }

  generateBtn.disabled = true;
  showStatus("", false);
  setView("loading");
  try {
    const data = await askGemini();
    if (data.error) {
      setView("empty");
      showStatus(data.error, true);
    } else if (!data.recipe || !data.recipe.steps) {
      setView("empty");
      showStatus("Couldn't build a recipe from that. Try adding more ingredients.", true);
    } else {
      renderResult(data);
    }
  } catch (err) {
    setView("empty");
    showStatus(err.message || "Something went wrong. Try again.", true);
  } finally {
    generateBtn.disabled = false;
  }
};