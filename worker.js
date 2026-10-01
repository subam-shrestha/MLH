function responseHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
}

function jsonResponse(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...responseHeaders(origin),
      "Content-Type": "application/json",
    },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const allowedOrigins = (env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    if (!origin || !allowedOrigins.includes(origin)) {
      return new Response("Origin not allowed.", { status: 403 });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: responseHeaders(origin),
      });
    }

    if (request.method !== "POST" || new URL(request.url).pathname !== "/api/generate") {
      return jsonResponse({ error: "Not found." }, 404, origin);
    }

    if (!env.GEMINI_API_KEY) {
      return jsonResponse({ error: "Gemini API key is not configured." }, 500, origin);
    }

    let payload;
    try {
      const body = await request.text();
      if (new TextEncoder().encode(body).byteLength > 8 * 1024 * 1024) {
        return jsonResponse({ error: "Request is too large." }, 413, origin);
      }
      payload = JSON.parse(body);
    } catch {
      return jsonResponse({ error: "Invalid JSON request." }, 400, origin);
    }

    if (!Array.isArray(payload.contents) || payload.contents.length === 0) {
      return jsonResponse({ error: "A prompt is required." }, 400, origin);
    }

    try {
      const upstream = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_MODEL || "gemini-3.8-flash")}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": env.GEMINI_API_KEY,
          },
          body: JSON.stringify(payload),
        },
      );
      return new Response(await upstream.arrayBuffer(), {
        status: upstream.status,
        headers: {
          ...responseHeaders(origin),
          "Content-Type": upstream.headers.get("Content-Type") || "application/json",
        },
      });
    } catch {
      return jsonResponse({ error: "Could not reach the Gemini API." }, 502, origin);
    }
  },
};