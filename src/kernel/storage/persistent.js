import p from 'path'
import R from 'ramda'
import fs from 'fs-extra'
import createDebug from 'debug'
import { remote } from 'electron'
import createIndex from 'lru-cache'
import { sha } from '../../util'

const debug = createDebug('app:kernel:storage:persistent')
const cacheDir = p.join(remote.app.getPath('userData'), remote.app.getName())
const pathForKey = key => p.join(cacheDir, sha(key, 64))
const indexFile = p.join(cacheDir, 'index')
const maxSize = Math.pow(2, 33)

let disposals = []
let pendingIndex = setupIndex()

function dispose (key) {
  const path = pathForKey(key)
  disposals.push(fs.remove(path))
  debug('DISPOSE', { key, path })
}

async function readIndex () {
  const exists = await fs.pathExists(indexFile)
  return exists ? fs.readJSON(indexFile) : { entries: [], size: 0 }
}

async function setupIndex () {
  await fs.ensureDir(cacheDir)
  const { entries } = await readIndex()
  const index = createIndex({ max: maxSize, length: R.identity, dispose })
  index.load(entries)
  debug('SETUP', { max: `${maxSize / Math.pow(2, 30)} GBytes`, entries })
  return index
}

async function writeIndex (index) {
  const entries = index.dump()
  const size = index.length
  await fs.writeJSON(indexFile, { entries, size })
  return index
}

const actions = {
  async clear (ctx) {
    const [index] = await Promise.all([pendingIndex, fs.remove(cacheDir)])
    index.reset()
    await (pendingIndex = setupIndex())
    debug('CLEAR', cacheDir)
  },

  async read (ctx, key) {
    const path = pathForKey(key)
    const exists = await fs.pathExists(path).catch(() => false)
    const buffer = exists ? await fs.readFile(path) : undefined
    debug('READ', { key, buffer })
    if (buffer) return buffer
  },

  async write (ctx, key, buffer) {
    const [index] = await Promise.all([pendingIndex, ...disposals])
    disposals = []
    index.set(key, buffer.length) // may actually trigger new disposals
    if (!index.has(key)) return
    try {
      await fs.writeFile(pathForKey(key), buffer)
    } catch (err) {
      index.del(key)
      return
    }
    await (pendingIndex = writeIndex(index))
    debug('WRITE', { key, buffer })
  }
}

export default { actions }