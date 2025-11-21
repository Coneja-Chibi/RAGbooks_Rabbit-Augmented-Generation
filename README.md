# Rabbit RAG Vectors Plugin

## Purpose

SillyTavern's built-in `/api/vector/*` endpoints strip out embedding vectors from responses, returning only metadata (hash, text, index). This prevents client-side similarity calculation using libraries like ST-Helpers.

This plugin provides alternative endpoints that return **full Vectra results including embedding vectors**, enabling use of client-side similarity algorithms.

## Endpoints

### POST /api/plugins/rabbit-rag-vectors/query-with-vectors

Query a collection and get results with embedding vectors.

**Request:**
```json
{
  "collectionId": "rabbit_chat_MyChar",
  "source": "palm",
  "queryVector": [0.1, 0.2, ...],
  "topK": 10,
  "threshold": 0.5
}
```

**Response:**
```json
{
  "results": [
    {
      "hash": 12345,
      "text": "chunk text",
      "index": 0,
      "vector": [0.1, 0.2, ...],
      "score": 0.85
    }
  ],
  "count": 1
}
```

### POST /api/plugins/rabbit-rag-vectors/list-with-vectors

List all items in a collection with embedding vectors.

**Request:**
```json
{
  "collectionId": "rabbit_chat_MyChar",
  "source": "palm"
}
```

**Response:**
```json
{
  "items": [
    {
      "hash": 12345,
      "text": "chunk text",
      "index": 0,
      "vector": [0.1, 0.2, ...]
    }
  ],
  "count": 1
}
```

### POST /api/plugins/rabbit-rag-vectors/get-item

Get a single item by hash with its embedding vector.

**Request:**
```json
{
  "collectionId": "rabbit_chat_MyChar",
  "source": "palm",
  "hash": 12345
}
```

**Response:**
```json
{
  "hash": 12345,
  "text": "chunk text",
  "index": 0,
  "vector": [0.1, 0.2, ...]
}
```

## Setup

1. **Enable server plugins** in `config.yaml`:
   ```yaml
   enableServerPlugins: true
   ```

2. **Restart SillyTavern**

3. **Verify plugin loaded** - Check console for:
   ```
   [Rabbit RAG Vectors Plugin] Ready!
   ```

## Usage

The Rabbit RAG extension will automatically detect if this plugin is available and use it for vector queries instead of ST's built-in endpoints.

This enables:
- Client-side similarity calculation with ST-Helpers
- Use of Cosine/Jaccard/Hamming distance algorithms
- Custom similarity thresholds and filtering
- Access to raw embedding vectors for debugging

## Security Note

This plugin provides direct access to Vectra vector databases. Only install if you trust the Rabbit RAG extension.
