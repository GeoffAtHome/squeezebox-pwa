import { argv } from 'process';

// Configuration
const LMS_SERVER = 'http://192.168.15.199';
const LMS_PORT = '9000';
const ALBUM_ID = argv[2];

/**
 * Interface for the expected LMS JSON-RPC response
 */
interface LMSResponse {
  result: {
    titles_loop?: Array<{
      artwork_track_id: string;
      id: string;
    }>;
  };
}

async function getAlbumArtworkUrl(albumId: string) {
  if (!albumId) {
    console.error("Error: Please provide an album ID.");
    console.log("Usage: npx ts-node script.ts <album_id>");
    return;
  }

  const rpcUrl = `${LMS_SERVER}:${LMS_PORT}/jsonrpc.js`;
  
  // Payload to find a track in the album and get its artwork ID (j tag)
  const payload = {
    id: 1,
    method: "slim.request",
    params: [
      0, // Global query, no specific player ID needed [7]
      ["tracks", 0, 1, `album_id:${albumId}`, "tags:j"]
    ]
  };

  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) throw new Error(`Server responded with ${response.status}`);

    const data = await response.json() as LMSResponse;
    console.log(JSON.stringify(data))
    const track = data.result.titles_loop ? data.result.titles_loop[0] : null ;

    if (track && track.id) {
      // Standardized artwork URL structure [3]
      const artworkUrl = `${LMS_SERVER}:${LMS_PORT}/music/${track.id}/cover.jpg`;
      console.log(`Artwork URL for Album ${albumId}:`);
      console.log(artworkUrl);
    } else {
      console.log(`No artwork found for Album ID: ${albumId}`);
    }
  } catch (error) {
    console.error("Failed to retrieve artwork:", error);
  }
}

getAlbumArtworkUrl(ALBUM_ID);