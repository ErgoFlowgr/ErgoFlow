/**
 * PDF parsing and chunking.
 * Uses pdf-parse in the renderer (via vite-plugin-electron-renderer).
 */
import { Buffer } from 'buffer'
import { uuid, insertDocument, insertChunks, getSettings } from './db'
import { getEmbedding, getAIConfig, type AIProvider } from './ai'

const CHUNK_SIZE = 500   // characters
const CHUNK_OVERLAP = 50

export async function processPDF(
  file: File,
  aiProvider: AIProvider,
  ollamaUrl?: string
): Promise<{ documentId: string; chunkCount: number }> {
  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  // pdf-parse
  const pdfParse = (await import('pdf-parse')).default
  const data = await pdfParse(buffer)

  const text = data.text
  const pages = data.numpages

  // Chunk the text
  const chunks = chunkText(text)

  // Get AI config for embeddings
  const settings = await getSettings()
  const config = await getAIConfig(aiProvider, ollamaUrl, settings.ollama_chat_model, settings.ollama_embed_model)

  // Store document metadata
  const documentId = uuid()
  await insertDocument({
    id: documentId,
    name: file.name,
    file_size: file.size,
    page_count: pages,
  })

  // Embed and store each chunk
  const chunkRecords = []
  for (let i = 0; i < chunks.length; i++) {
    const embedding = await getEmbedding(chunks[i], config)
    chunkRecords.push({
      id: uuid(),
      document_id: documentId,
      content: chunks[i],
      embedding: JSON.stringify(embedding),
      chunk_index: i,
      page_number: Math.floor((i / chunks.length) * pages) + 1,
    })
  }
  await insertChunks(chunkRecords)

  return { documentId, chunkCount: chunks.length }
}

function chunkText(text: string): string[] {
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length)
    chunks.push(text.slice(start, end).trim())
    start += CHUNK_SIZE - CHUNK_OVERLAP
  }
  return chunks.filter(c => c.length > 50)
}
