# 📚 RAGBooks

> **Universal RAG system for vectorizing and intelligently injecting any text content**

RAGBooks is a powerful SillyTavern extension that uses Retrieval-Augmented Generation (RAG) to vectorize your lorebooks, character cards, chat history, and custom documents. Instead of flooding context with entire documents, RAGBooks intelligently injects only the most relevant chunks based on your conversation—saving **80-90% of context** while maintaining full access to information.

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/Coneja-Chibi/RAGBooks)
[![SillyTavern](https://img.shields.io/badge/SillyTavern-compatible-green.svg)](https://github.com/SillyTavern/SillyTavern)
[![License](https://img.shields.io/badge/license-MIT-orange.svg)](LICENSE)

---

## ✨ Features

- **🔍 Smart Semantic Search**: Uses vector embeddings to find relevant information based on meaning, not just keywords
- **💾 Massive Context Savings**: Inject only what's needed—reduce context usage by 80-90%
- **📦 Multiple Content Sources**: Lorebooks, character cards, chat history, web pages, wikis, YouTube transcripts, GitHub repos, and more
- **🎯 Advanced Retrieval**: Dual-vector search, importance weighting, conditional activation, chunk groups, temporal decay
- **🎬 Scene Management**: Mark and manage scenes in long RP chats with titles, summaries, and smart vectorization
- **⚙️ Flexible Chunking**: Multiple strategies per content type—per entry, paragraph, semantic, fixed size, by speaker
- **🌍 Language Agnostic**: Full Unicode support—works with any language (English, Japanese, Chinese, Korean, Arabic, Cyrillic, etc.)
- **🔌 Provider Support**: Works with 14+ embedding providers (OpenAI, Cohere, Mistral, Ollama, local transformers, etc.)

---

## 📖 How It Works

1. **Vectorize**: Content is split into "chunks" (text segments) and converted to vector embeddings
2. **Store**: Chunks are stored in collections (global, character-specific, or chat-specific)
3. **Retrieve**: During chat, user messages are compared to chunk embeddings using semantic similarity
4. **Inject**: Top-K most relevant chunks are automatically injected into AI context at configurable depth
5. **Chat**: You chat normally—RAGBooks handles intelligent context injection in the background

**Example**: You mention "dragons" in chat. RAGBooks finds your lorebook's dragon entry, character's dragon-slaying backstory, and that conversation you had about dragons 200 messages ago—all automatically injected without manual triggers.

---

## 🗂️ Content Sources

### 📚 Lorebooks / World Info

Vectorize lorebook entries as searchable chunks—alternative to keyword-based triggers.

**Chunking Strategies:**
- **Per Entry** (Recommended): One entry = one chunk
- **Paragraph**: Split entries by double newlines
- **Natural Vectorization**: Semantic recursive splitting with overlap
- **Fixed Size**: Size-based chunking (200-1000 chars) with overlap (0-200 chars)

**Use Case**: 100-entry world info book → only inject 3-5 relevant entries per message instead of keyword-matching dozens

---

### 👤 Character Cards

Split character descriptions into searchable sections—perfect for detailed characters.

**Chunking Strategies:**
- **Per Field** (Default): Each field (description, personality, etc.) as separate chunk
- **Paragraph**: Split fields by paragraphs
- **Natural Vectorization**: Recursive semantic splitting
- **Smart Merge**: Intelligently combine related fields

**Use Case**: 3000-word character card → inject only personality section when discussing character traits, backstory when asking about past

---

### 💬 Chat History

Make past conversations searchable and retrievable.

**Chunking Strategies:**
- **By Scene**: Uses scene boundaries (if scenes marked)
- **By Speaker**: Groups consecutive messages by speaker
- **Fixed Size**: ~400 char chunks with overlap
- **Natural Vectorization**: Semantic splitting

**Scene Management:**
- Mark message ranges as scenes with titles/summaries
- Green flag button = scene start
- Red flag button = scene end
- Edit scene metadata in chunk viewer's Scenes tab

**Use Case**: 500+ message RP → retrieve that tavern brawl from 300 messages ago when characters reminisce about it

---

### 🌐 URL / Webpage

Fetch and vectorize web content with clean HTML extraction.

**Features:**
- Uses SillyTavern's Readability integration for clean text
- Auto-fills collection name from domain
- All chunking strategies available
- Optional AI summarization

**Use Case**: Scrape D&D spell list webpage → inject only Fireball description when player asks "how does Fireball work?"

---

### 📄 Custom Documents

Multiple input methods for maximum flexibility.

#### 📝 Paste Text
Direct text input via textarea—simple and straightforward.

#### 🌐 Fetch from URL
Scrapes webpage content automatically using Readability.

#### 📖 Scrape Wiki Page
**Supports:**
- Fandom wikis (e.g., baldursgate.fandom.com)
- MediaWiki (e.g., Wikipedia)

**Requirements:** [SillyTavern-Fandom-Scraper plugin](https://github.com/SillyTavern/SillyTavern-Fandom-Scraper)

**Configuration:**
- Wiki type selection (Fandom/MediaWiki)
- URL input
- Optional category filter

#### 📺 YouTube Transcript
Fetch video transcripts with optional language selection.

**Configuration:**
- Video URL or ID
- Language code (e.g., "en", "es", "ja")
- Supports all standard YouTube URL formats

#### 📦 GitHub Repository
Download files from GitHub repos with glob pattern filtering.

**Configuration:**
- Repository URL
- Glob pattern (e.g., "*.md", "docs/*.txt")
- Branch selection (default: main/master)
- README-only mode or filtered files

**Use Case**: Scrape SillyTavern docs from GitHub → inject relevant doc sections when user asks "how do I configure X?"

#### 📎 Upload Files
Batch file upload support.

**Supported formats:** `.txt`, `.md`, `.json`, `.yaml`, `.html`

**Use Case**: Upload 10 lore documents → all vectorized and searchable

---

## 🔬 Advanced Features

### 🔍 Dual-Vector Search

**What it does:** Chunks can have both summaries and full text, each vectorized separately.

**How it works:**
1. Create concise summary of chunk (or use AI to generate)
2. Check "Create separate vector for scene summary"
3. Summary is vectorized separately from full text
4. **Search Modes:**
   - **Both** (Recommended): Searches summaries + full text, merges with RRF (Reciprocal Rank Fusion)
   - **Summary Only**: Only searches summaries
   - **Full Text Only**: Only searches full text
5. When summary matches, full chunk is injected

**Benefits:**
- Long chunks (1000+ chars) get concise summaries
- Summaries match queries semantically
- Full detailed text is still injected
- Better retrieval for dense content

**Example:** 800-word character backstory → 50-word summary "orphaned by dragon attack, trained as knight". Query "dragon trauma" matches summary, full backstory injected.

---

### ⚖️ Importance Weighting

**What it does:** Boost or reduce chunk relevance scores (0-200% scale).

**How it works:**
- Default: 100% (neutral)
- High importance: 125-200% (1.25x - 2x score multiplier)
- Low importance: 0-74% (0x - 0.74x score multiplier)
- Additive boost: +0.05 for 150%, -0.05 for 50%

**Display Modes:**
- **Continuous Scoring**: Sort by final relevance score
- **Priority Tiers**: Group into Critical (175-200%), High (125-174%), Normal (75-124%), Low (0-74%)
  - Critical chunks always come first regardless of similarity

**Use Case:** Mark critical plot points as 200% importance → always retrieved first when relevant, even if similarity score is lower than minor details.

---

### 🎯 Conditional Activation

**What it does:** Chunks only activate when specific conditions are met.

**Logic Modes:**
- **AND**: All conditions must match
- **OR**: Any condition matches

**Condition Types:**

1. **keyword**: Keyword appears in recent messages
2. **speaker**: Last speaker matches value
3. **messageCount**: Message count ≥ threshold
4. **chunkActive**: Another chunk (by hash) is active in results
5. **timeOfDay**: Real-world time in range (HH:MM-HH:MM, supports midnight crossing)
6. **emotion**: Emotion detected in recent messages
   - Options: happy, sad, angry, neutral, excited, fearful, surprised
7. **location**: Location keyword in messages or metadata
   - Supports `{{location}}` macro
8. **characterPresent**: Character name appears as speaker in recent messages
9. **storyBeat**: Story phase/beat from metadata
   - Supports `{{storyphase}}` macro
10. **randomChance**: Random percentage chance (0-100%)

**Negation:** Each condition can be negated (NOT logic)

**Context Window:** Configurable recent message window (default: 10 messages)

**Example:**
- Dragon weakness entry with conditions:
  - `keyword="dragon"` AND `speaker="DragonSlayer"` AND `NOT emotion="fearful"`
  - Only injects when dragon mentioned, DragonSlayer speaking, and NOT afraid

---

### 📦 Chunk Groups

**What it does:** Group related chunks for collective keyword matching and requirement enforcement.

**How it works:**
1. Assign chunks to named group (e.g., "Combat Abilities")
2. Define group keywords (e.g., ["fight", "attack", "combat", "battle"])
3. When ANY group keyword matches query, ALL chunks in group get boosted
4. Optional: Mark group as "required" → at least 1 chunk from group MUST be in results

**Settings:**
- **Boost Multiplier**: Score multiplier when group keywords match (default: 1.3x = 30% boost)
- **Force-Include Limit**: Max 5 chunks can be force-included from required groups

**Use Case:**
- 10 combat ability chunks grouped as "Combat Moves"
- Group keywords: ["fight", "attack", "combat"]
- User says "I attack the goblin"
- All 10 abilities get 30% boost → more likely to retrieve relevant moves

---

### ⏳ Temporal Decay (Chat Only)

**What it does:** Reduce relevance of older chat chunks over time (OFF by default).

**Decay Modes:**
- **Exponential**: Natural decay curve (recent stays strong, old drops quickly)
  - Half-life setting: Messages until 50% relevance (default: 50, range: 10-200)
- **Linear**: Steady decline over time
  - Linear rate: % decay per message (default: 1%, range: 1-10%)

**Settings:**
- **Minimum Relevance**: Never decay below this % (default: 30%, range: 0-100%)
- **Scene-Aware Mode**: Resets decay at scene boundaries

**Use Case:**
- 500+ message RP chat
- Recent 50 messages stay at 100%
- Old messages decay to 30% but can still be retrieved if highly relevant
- Scene-aware mode resets decay at scene starts (tavern brawl scene stays fresh while in tavern)

---

## 🖥️ Chunk Viewer

### 3-Tab Interface

#### 📦 Chunks Tab

View and edit all chunks in the collection.

**Search & Display:**
- Text search across all chunks
- Format toggle (plain text vs formatted)
- Statistics (chunk count, source info)

**Per-Chunk Editing:**
- **Chunk Name**: Custom name for easy identification
- **Text Content**: Edit chunk text (triggers re-vectorization)
- **Primary Keywords**:
  - System keywords (auto-generated, read-only)
  - Custom keywords (user-added)
  - Keyword weights (boost specific keywords 0-200%)
  - Disable keywords (remove from search)
- **Summary Vectors (Searchable)**:
  - Multi-tag Select2 input
  - Add searchable summaries of any length
  - Each tag creates separate vector
  - Matching any summary pulls full chunk
- **Importance**: Slider (0-200%, default 100%)
- **Conditional Activation**:
  - Enable toggle
  - AND/OR mode
  - Add/remove condition rules (10 types)
  - Configure condition values
  - Negate conditions
- **Chunk Groups**:
  - Group name
  - Group keywords (comma-separated)
  - "Require group member" toggle
  - "Prioritize inclusion" toggle
- **Disable Toggle**: Temporarily disable chunk from search

**Scene Chunks (Chat Only):**
- **Scene Vectorization**: Toggle "Create separate vector for scene summary"
  - Controls visibility of Summary Vectors section
  - When enabled, scene summary is vectorized separately

---

#### 🎬 Scenes Tab (Chat Only)

View and manage all marked scenes.

**Scene Cards Display:**
- Scene title (editable, syncs with chunk name)
- Message range (start-end)
- Message count
- Summary (view-only, edit in Chunks tab)
- Keywords (view-only)
- Jump to scene in chat button
- Delete scene button

**Features:**
- Scene creation instructions
- Empty state with guidance
- Live scene metadata updates

**Scene Synchronization:**
- Editing scene title also updates chunk name
- Editing chunk name also updates scene title
- Changes persist across tabs

---

#### 📚 Groups Tab

View all chunk groups and their members.

**Group Cards Display:**
- Group name
- Member count
- Group keywords
- Required status (⭐ if required)
- List of member chunks

**Empty State:**
- Explains how groups are created
- Guides user to Chunks tab

---

### Common Features (All Tabs)
- **Save Button**: Saves all changes to library
- **Cancel Button**: Discards changes
- **Live Updates**: Changes reflected immediately in UI
- **Unsaved Changes Warning**: Prompts before closing with unsaved changes

---

## 📥 Installation

### Method 1: Git Clone (Recommended)

```bash
cd SillyTavern/public/scripts/extensions/third-party
git clone https://github.com/Coneja-Chibi/RAGBooks.git
```

### Method 2: Manual Download

1. Download the latest release
2. Extract to `SillyTavern/public/scripts/extensions/third-party/RAGBooks`
3. Restart SillyTavern

### Optional: Wiki Scraper Plugin

To enable wiki scraping features:

```bash
cd SillyTavern
npm install --save https://github.com/SillyTavern/SillyTavern-Fandom-Scraper.git
```

---

## 🚀 Quick Start Guide

### Step 1: Enable Extension

1. Open SillyTavern
2. Click **Extensions** (stacked blocks icon)
3. Find **RAGBooks** in the list
4. Click to expand settings
5. Toggle **Enable RAGBooks** ON

### Step 2: Configure Embedding Provider

RAGBooks uses SillyTavern's built-in Vectors extension:

1. Go to **Extensions** > **Vector Storage**
2. Select embedding source (e.g., OpenAI, transformers, Ollama)
3. Configure API keys if needed
4. Test connection

### Step 3: Add Content Source

1. In RAGBooks settings, find **"Add New Source"** dropdown
2. Select content type (Lorebook, Character Card, Chat History, URL, Custom Document)
3. Follow the configuration prompts:
   - For **Lorebooks**: Select lorebook from dropdown
   - For **Character Cards**: Select character
   - For **Chat History**: Choose chunking strategy
   - For **URL**: Enter webpage URL
   - For **Custom**: Choose input method (paste, URL, wiki, YouTube, GitHub, upload)

### Step 4: Configure Chunking

1. Select **chunking strategy** based on content type
2. Adjust **chunk size** and **overlap** if using fixed/natural chunking
3. Choose whether to **summarize chunks** (recommended for long chunks)
4. Select **summary style** if enabled (Concise, Detailed, Keywords, Extractive)
5. Enable **metadata extraction** to auto-extract keywords

### Step 5: Vectorize

1. Click **Vectorize** button
2. Wait for processing (progress shown)
3. Chunks appear in library
4. Click **View Chunks in Visualizer** to inspect

### Step 6: Chat Normally

1. Start chatting with your character
2. RAGBooks automatically retrieves and injects relevant chunks
3. No manual triggers needed—works in the background
4. Check injected chunks with **World Info** debug (if enabled)

---

## ⚙️ Settings Reference

### Global RAG Settings

- **Enable RAGBooks**: Master toggle for all RAG-based injection
- **Orange Accent Mode**: Use vibrant orange accents (vs theme colors)
- **Top-K Results**: How many chunks to inject per message (1-10, default: 3)
- **Relevance Threshold**: Minimum similarity score for inclusion (0-1, default: 0.15)
  - Lower = more permissive (more chunks)
  - Higher = more strict (fewer, more relevant chunks)
- **Injection Depth**: Where in AI context to inject chunks (1-10, default: 4)
  - Lower = closer to recent messages (more influence)
  - Higher = deeper in context (less influence)

### Advanced Search Features

#### Summary Search Mode
- **Both** (Recommended): Dual-vector search—searches summaries + full text, merges results
- **Summary Only**: Only searches chunk summaries
- **Full Text Only**: Only searches full chunk text

#### Importance Weighting
- **Enable/Disable**: Toggle importance-based scoring
- **Display Mode**:
  - **Continuous Scoring**: Sort by final relevance score
  - **Priority Tiers**: Group into Critical/High/Normal/Low tiers

#### Conditional Activation
- **Enable/Disable**: Allow chunks to set activation conditions
- Configured per-chunk in viewer

#### Chunk Groups
- **Enable/Disable**: Allow chunks to form groups with shared keywords
- **Group Boost Multiplier**: Score multiplier when group keywords match (1.0-3.0x, default: 1.3x)

#### Context Window
- **Messages to Consider**: Recent messages for conditional activation (5-50, default: 10)

#### Temporal Decay (Chat Only)
- **Enable/Disable**: Reduce relevance of older chat chunks (OFF by default)
- **Decay Mode**:
  - **Exponential**: Natural decay curve
    - **Half-Life**: Messages until 50% relevance (10-200, default: 50)
  - **Linear**: Steady decline
    - **Linear Rate**: % decay per message (1-10%, default: 1%)
- **Minimum Relevance**: Never decay below this % (0-100%, default: 30%)
- **Scene-Aware Decay**: Reset decay at scene boundaries

### Per-Source Configuration

When adding content sources:

- **Collection Name**: Custom identifier for the collection
- **Chunking Strategy**: Strategy selection (varies by content type)
- **Chunk Size**: For size-based chunking (200-1000 chars, default: 400)
- **Chunk Overlap**: For size-based chunking (0-200 chars, default: 50)
- **Summarize Chunks**: Generate AI summaries (Yes/No)
- **Summary Style**: Concise, Detailed, Keywords, Extractive
- **Per-Chunk Summary Control**: Let chunks override summary settings
- **Extract Metadata**: Auto-extract keywords/tags
- **Per-Chunk Metadata Control**: Let chunks override metadata settings

---

## 💡 Use Cases

### Use Case 1: Combat System Lorebook

**Scenario:** You have a lorebook with 20 detailed combat abilities (each 500+ words).

**Setup:**
1. Vectorize lorebook with **Per Entry** chunking
2. In chunk viewer, assign all entries to group "Combat Abilities"
3. Set group keywords: `["fight", "attack", "combat", "battle", "cast", "spell"]`
4. Mark group as **Required**
5. Set importance to **150%** for most powerful abilities

**Result:**
- When user says "I attack the goblin", at least 1 combat ability always injected
- All abilities get 30% boost from group keyword match
- Most powerful abilities (150% importance) prioritized
- Only inject 3-5 abilities instead of flooding context with all 20

---

### Use Case 2: Character with Traumatic Past

**Scenario:** Character card has detailed trauma backstory (800 words) that should only appear when relevant.

**Setup:**
1. Vectorize character card with **Per Field** chunking
2. Find trauma chunk in viewer
3. Set importance to **150%** (high priority when relevant)
4. Add conditional activation:
   - **OR** mode
   - Condition 1: `keyword="trauma"`
   - Condition 2: `keyword="past"`
   - Condition 3: `keyword="childhood"`
   - Condition 4: `emotion="sad"`
5. Create summary: "Orphaned at age 6 in dragon attack, raised by monks, struggles with survivor's guilt"

**Result:**
- Trauma chunk only injects when keywords/emotion match
- When relevant, gets high priority (150%)
- Summary helps retrieval ("tell me about your past" → matches "orphaned" → full chunk injected)
- Avoids constant trauma dumping in casual conversations

---

### Use Case 3: Long RP with Scene Management

**Scenario:** 500+ message ongoing RP with multiple story arcs.

**Setup:**
1. Vectorize chat with **By Scene** chunking
2. Mark scenes every 20-30 messages:
   - Scene 1: "Tavern Brawl" (messages 1-28)
   - Scene 2: "Forest Journey" (messages 29-61)
   - Scene 3: "Castle Intrigue" (messages 62-95)
   - ...and so on
3. Each scene has title + AI-generated summary
4. Enable **Temporal Decay** (exponential mode)
   - Half-life: 50 messages
   - Min relevance: 30%
   - **Scene-Aware** ON
5. Enable dual-vector search for scene summaries

**Result:**
- Recent scene (last 50 messages) stays at 100% relevance
- Old scenes decay to 30% but summaries help retrieval
- When user says "Remember that tavern fight?", summary matches → full scene injected
- Decay resets at scene boundaries (current scene always fresh)
- No manual searching through 500 messages

---

### Use Case 4: Wiki Documentation

**Scenario:** Scrape Baldur's Gate 3 Fandom wiki for game knowledge.

**Setup:**
1. Select **Custom Document** > **Scrape Wiki Page**
2. Wiki type: **Fandom**
3. URL: `https://baldursgate.fandom.com`
4. Category filter: *leave empty for full wiki*
5. Chunking: **Natural Vectorization** (optimal for wiki articles)
   - Chunk size: 600
   - Overlap: 100
6. **Summarize Chunks**: Yes
7. Summary style: **Concise**
8. **Extract Metadata**: Yes

**Result:**
- Long wiki articles chunked semantically (respects paragraphs, sections)
- Each chunk gets concise AI summary
- Dual-vector search: summaries match queries, full text injected
- When user asks "How does sneak attack work?", retrieves sneak attack section
- Metadata extraction pulls game terms as keywords (Rogue, Advantage, d6)

---

## 🔧 Dependencies

### Required

- **SillyTavern**: Latest version recommended
- **Vectors Extension**: Built-in SillyTavern extension (enabled by default)

### Embedding Providers

RAGBooks supports **14+ embedding providers** via SillyTavern's Vectors extension:

1. **transformers** (default): Local transformers.js (no API key needed)
2. **openai**: OpenAI embeddings API
3. **mistral**: Mistral AI embeddings
4. **cohere**: Cohere embeddings
5. **nomicai**: Nomic AI embeddings
6. **togetherai**: Together AI embeddings
7. **ollama**: Local Ollama server
8. **llamacpp**: Local llama.cpp server
9. **vllm**: vLLM server
10. **koboldcpp**: KoboldCpp server
11. **webllm**: Client-side WebLLM
12. **palm**: Google PaLM (MakerSuite)
13. **vertexai**: Google Vertex AI
14. **extras**: SillyTavern Extras server

### Optional Plugins

- **[SillyTavern-Fandom-Scraper](https://github.com/SillyTavern/SillyTavern-Fandom-Scraper)**: Required for wiki scraping
  - Enables Fandom wiki scraping
  - Enables MediaWiki scraping
  - Install: `npm install --save https://github.com/SillyTavern/SillyTavern-Fandom-Scraper.git`

### Optional Features

- **AI Summarization**: Uses SillyTavern's `/api/summarize` endpoint (requires connected AI)
- **Readability Integration**: Uses `/api/content/import` for clean HTML extraction (built-in)

---

## 🌟 Special Features

### BunnymoTags Support

RAGBooks automatically detects and processes **BunnymoTags** format (`<TAG:value>`).

**Language-Agnostic Tag Structure:**
- `<NAME:John>` (English)
- `<名前:太郎>` (Japanese)
- `<NOMBRE:Juan>` (Spanish)
- `<NOM:Jean>` (French)

Works with ANY language—tag detection is Unicode-aware.

### Advanced Keyword Extraction

**Hybrid Approach:**
- Frequency analysis + section-specific weighting
- English Language Bank for automatic keyword enhancement
- 8 predefined sections: Identity, Physical, Psyche, Relational, Linguistic, Origin, Aesthetic, Psychological

**Keyword Presets:**
- Dere types (tsundere, yandere, etc.)
- Attachment styles (secure, anxious, avoidant)
- Trauma/wounds
- Boundaries
- Flirtation styles
- Jealousy triggers
- Arousal patterns
- Conflict resolution
- Hidden depths

### Language Support

- **Language-Agnostic**: Works with ANY language
- **Unicode Support**: Full support for Chinese, Japanese, Korean, Arabic, Cyrillic, Thai, Hebrew, etc.
- **Section Detection**: Recognizes headers in any language:
  - `## SECTION 1/8` (English)
  - `##セクション 1/8` (Japanese)
  - `##Раздел 1/8` (Russian)
  - `##第1节/共8节` (Chinese)

### Search Orchestrator Pipeline

RAGBooks applies features in optimal order for best results:

1. Filter by search mode (summary/full/both)
2. Perform vector search (single or dual)
3. Expand summary chunks to include parents
4. Apply conditional activation filtering
5. Apply group keyword boosts
6. Apply importance weighting
7. Apply temporal decay (if enabled)
8. Re-rank by adjusted scores
9. Enforce required group members
10. Limit to topK

This pipeline ensures all features work together harmoniously.

---

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 👤 Author

**Coneja Chibi**

- GitHub: [@Coneja-Chibi](https://github.com/Coneja-Chibi)
- Other Extensions: [BunnyMo](https://github.com/Coneja-Chibi/BunnyMo), [CarrotKernel](https://github.com/Coneja-Chibi/CarrotKernel), [Rabbit Response Team](https://github.com/Coneja-Chibi/Rabbit-Response-Team)

---

## 🙏 Acknowledgments

- SillyTavern team for the amazing platform
- LangChain for RAG inspiration
- Everyone who contributed feedback and testing

---

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/Coneja-Chibi/RAGBooks/issues)
- **Discussions**: [SillyTavern Discord](https://discord.gg/sillytavern)

---

**Made with ❤️ by Coneja Chibi**
