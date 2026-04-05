import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { ElevenLabsClient } from "elevenlabs";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  let elevenlabsClient: ElevenLabsClient | null = null;

  const getElevenLabs = () => {
    if (!elevenlabsClient) {
      const apiKey = process.env.ELEVENLABS_API_KEY || "8e1d3f293e232b6775c4afd7a21d450b07b0df0e31097964f4c6c322f7b0d32e";
      if (!apiKey) {
        throw new Error("ELEVENLABS_API_KEY is required");
      }
      elevenlabsClient = new ElevenLabsClient({ apiKey });
    }
    return elevenlabsClient;
  };

  // API Route for ElevenLabs TTS
  app.post("/api/tts", async (req, res) => {
    try {
      const { text, voiceId = "1Z7Y8o9cvUeWq8oLKgMY" } = req.body;
      if (!text) return res.status(400).json({ error: "Text is required" });

      console.log(`Generating TTS for: ${text.substring(0, 50)}...`);

      const client = getElevenLabs();
      const audio = await client.textToSpeech.convert(voiceId, {
        text,
        model_id: "eleven_multilingual_v2",
        output_format: "mp3_44100_128",
      });

      // ElevenLabs returns a stream or a buffer. The SDK returns a stream in Node.
      // We can pipe it or collect it.
      res.setHeader("Content-Type", "audio/mpeg");
      audio.pipe(res);
    } catch (error: any) {
      console.error("ElevenLabs Error:", error);
      res.status(500).json({ error: error.message || "Failed to generate TTS" });
    }
  });

  // API Route for YouTube Search (to get full songs)
  app.get("/api/search-youtube", async (req, res) => {
    try {
      const { q } = req.query;
      if (!q) return res.status(400).json({ error: "Query is required" });

      console.log(`Searching YouTube for: ${q}`);
      const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(q as string)}`;
      const response = await fetch(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });
      const html = await response.text();
      
      // Look for the first video ID in the HTML
      const videoIdMatch = html.match(/"videoId":"([^"]+)"/);
      if (videoIdMatch && videoIdMatch[1]) {
        const videoId = videoIdMatch[1];
        return res.json({ url: `https://www.youtube.com/watch?v=${videoId}` });
      }

      res.status(404).json({ error: "No video found" });
    } catch (error: any) {
      console.error("YouTube Search Error:", error);
      res.status(500).json({ error: "Failed to search YouTube" });
    }
  });
  
  // API Route for Last.fm Top Tracks
  app.get("/api/top-tracks", async (req, res) => {
    try {
      const limit = req.query.limit || 5;
      const apiKey = process.env.LASTFM_API_KEY || "0b415a1c6ebfff9919a99445d09721aa";
      const url = `https://ws.audioscrobbler.com/2.0/?method=chart.gettoptracks&api_key=${apiKey}&format=json&limit=${limit}`;
      
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.error("Last.fm API Error:", error);
      res.status(500).json({ error: "Failed to fetch top tracks" });
    }
  });

  // API Route for iTunes Search
  app.get("/api/search-music", async (req, res) => {
    try {
      const { term, limit = 5 } = req.query;
      if (!term) return res.status(400).json({ error: "Term is required" });
      
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term as string)}&media=music&limit=${limit}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.error("iTunes API Error:", error);
      res.status(500).json({ error: "Failed to search music" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
