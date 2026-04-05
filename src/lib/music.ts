/// <reference types="vite/client" />

export interface Track {
  name: string;
  artist: {
    name: string;
    url?: string;
  };
  url: string;
  previewUrl?: string;
  image?: string;
  duration?: number;
}

const FALLBACK_TRACKS: Track[] = [
  {
    name: "Lofi Girl - Study Session",
    artist: { name: "Lofi Girl" },
    url: "https://www.youtube.com/watch?v=5qap5aO4i9A",
    previewUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
    image: "https://picsum.photos/seed/lofi/200/200"
  },
  {
    name: "Midnight City",
    artist: { name: "M83" },
    url: "https://www.youtube.com/watch?v=dX3k_UAnyAw",
    previewUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
    image: "https://picsum.photos/seed/midnight/200/200"
  }
];

export async function searchSongs(query: string, limit: number = 5): Promise<Track[]> {
  const url = `/api/search-music?term=${encodeURIComponent(query)}&limit=${limit}`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    if (!data.results || data.results.length === 0) return [];
    
    const tracks = await Promise.all(data.results.map(async (item: any) => {
      const track = {
        name: item.trackName,
        artist: {
          name: item.artistName,
        },
        url: item.trackViewUrl,
        previewUrl: item.previewUrl, // Default to iTunes preview
        image: item.artworkUrl100,
        duration: item.trackTimeMillis ? item.trackTimeMillis / 1000 : 0
      };

      // Try to get full YouTube URL
      try {
        const ytSearchUrl = `/api/search-youtube?q=${encodeURIComponent(track.name + " " + track.artist.name)}`;
        const ytResponse = await fetch(ytSearchUrl);
        if (ytResponse.ok) {
          const ytData = await ytResponse.json();
          console.log("YouTube search result for", track.name, ":", ytData.url);
          if (ytData.url) {
            track.previewUrl = ytData.url; // Replace preview with full YouTube URL
          }
        }
      } catch (ytErr) {
        console.error("YouTube search failed for track:", track.name, ytErr);
      }

      return track;
    }));

    return tracks;
  } catch (err) {
    console.error("Search Music API Error:", err);
    return [];
  }
}

export async function getTopTracks(limit: number = 5): Promise<Track[]> {
  const url = `/api/top-tracks?limit=${limit}`;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    if (!data.tracks || !data.tracks.track) return FALLBACK_TRACKS;
    
    // Last.fm returns a slightly different structure than iTunes
    return data.tracks.track.map((t: any) => ({
      name: t.name,
      artist: { name: t.artist.name },
      url: t.url,
      previewUrl: "", // We'll search for this later if needed
      image: t.image?.[2]?.["#text"] || `https://picsum.photos/seed/${t.name}/200/200`
    }));
  } catch (err) {
    console.error("Music API Error:", err);
    return FALLBACK_TRACKS;
  }
}
