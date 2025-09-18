# Clario Video: Runway Gen-4 Turbo (Image-to-Video)

This project integrates Runway's Gen-4 Turbo image-to-video in a Runway-only configuration.

## Supported capabilities

- Provider: runway (server-enforced)
- Models:
  - Preview: `gen-4-turbo` (mapped to REST id `gen4_turbo`)
  - HD: `gen-4-turbo` (configurable)
- Generation mode: image-to-video
- Durations: 5–10 seconds (server clamps outside range and includes warnings)
- Aspect/ratio: 16:9, 9:16, 1:1 mapped to Runway ratio strings `1280:720`, `720:1280`, `1024:1024`
- Input image: base64 data URI (server will construct `data:<mime>;base64,` for Runway)

## Required configuration

Set Firebase Functions config keys (do NOT commit secrets):

```
firebase functions:config:set \
  video.provider=runway \
  video.runway.key="<RUNWAY_API_KEY>" \
  video.runway.model_preview="gen-4-turbo" \
  video.runway.model_hd="gen-4-turbo"
```

Then deploy:

```
firebase deploy --only functions
```

Note: A predeploy step compiles TypeScript to `functions/lib/` to avoid stale code.

## Error handling and moderation

- Runway 4xx errors are returned verbatim to the client with the original HTTP status.
- Rate limit (429) returns `{ code: "VIDEO_RATE_LIMIT", retryAfter }`.
- If a provider policy/moderation message is detected, the response includes a friendly `userMessage` suggesting a neutral phrasing (e.g., "a purple dinosaur dancing").

## Example cURL (direct Runway API)

Replace `RUNWAY_API_KEY` and `DATA_URI` with your values.

```bash
curl -X POST \
  https://api.dev.runwayml.com/v1/image_to_video \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer RUNWAY_API_KEY' \
  -H 'X-Runway-Version: 2024-11-06' \
  -d '{
    "model": "gen4_turbo",
    "promptText": "a purple dinosaur dancing",
    "promptImage": "DATA_URI", 
    "ratio": "1280:720",
    "duration": 5
  }'
```

To poll the task:

```bash
curl -X GET \
  https://api.dev.runwayml.com/v1/tasks/TASK_ID \
  -H 'Authorization: Bearer RUNWAY_API_KEY' \
  -H 'X-Runway-Version: 2024-11-06'
```

When `status` is `SUCCEEDED`, download the resulting URL and store it. The Cloud Function does this automatically and returns a signed URL.

## Frontend behavior

- `/video` sends: provider/runway, model/gen-4-turbo, mode, generationMode=image-to-video, durationSec, prompt, imageBase64.
- On error, the toast surfaces provider `code`/`message` and `retryAfter` when present.

## Notes

- The backend ignores client provider/model and enforces Runway via server config.
- Prompt-to-video is not yet implemented and returns `NOT_IMPLEMENTED`.
- Ensure your Firebase project has Storage and Firestore enabled; the function writes to `creations` and uploads to `renders/{uid}/...`.
