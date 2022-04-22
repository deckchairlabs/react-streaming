export { renderToStream }

import React from 'react'
import { renderToPipeableStream } from 'react-dom/server'
import { SsrDataProvider } from './useSsrData'
import { StreamProvider } from './useStream'
import { assert } from './utils'
import type { Readable as ReadableType, Writable as WritableType } from 'stream'

async function renderToStream(element: React.ReactNode) {
  let reject: (err: unknown) => void
  let resolve: () => void
  let resolved = false
  const promise = new Promise<{ pipe: Pipe }>((resolve_, reject_) => {
    resolve = () => {
      if (resolved) return
      resolved = true
      resolve_({ pipe: pipeWrapper })
    }
    reject = (err: unknown) => {
      if (resolved) return
      resolved = true
      reject_(err)
    }
  })

  // https://github.com/omrilotan/isbot
  // https://github.com/mahovich/isbot-fast
  // https://stackoverflow.com/questions/34647657/how-to-detect-web-crawlers-for-seo-using-express/68869738#68869738
  const isBot = false
  const seoStrategy: string = 'conservative'
  // const seoStrategy = 'speed'

  const onError = (err: unknown) => {
    reject(err)
  }

  const streamUtils = { injectToStream: (chunk: string) => injectToStream(chunk) }

  element = React.createElement(StreamProvider, { value: streamUtils }, element)
  element = React.createElement(SsrDataProvider, null, element)

  let { pipe } = renderToPipeableStream(element, {
    onAllReady() {
      resolve()
    },
    onShellReady() {
      if (!isBot || seoStrategy === 'speed') {
        resolve()
      }
    },
    onShellError: onError,
    onError
  })

  const { pipeWrapper, injectToStream } = getPipeWrapper(pipe)
  ;(pipeWrapper as any).injectToStream = injectToStream

  return promise
}

function getPipeWrapper(pipeOriginal: Pipe) {
  const { Writable } = loadStreamNodeModule()

  let state: 'UNSTARTED' | 'STREAMING' | 'ENDED' = 'UNSTARTED'
  let write: null | ((_chunk: string) => void) = null
  const buffer: string[] = []
  const pipeWrapper = createPipeWrapper()

  return { pipeWrapper, injectToStream }

  function injectToStream(chunk: string) {
    process.nextTick(() => {
      assert(state !== 'ENDED')
      // console.log('injectToStream', state)
      if (state === 'STREAMING') {
        flushBuffer()
        assert(write)
        write(chunk)
      } else if (state === 'UNSTARTED') {
        buffer.push(chunk)
      } else {
        assert(false)
      }
    })
  }

  function flushBuffer() {
    if (buffer.length === 0) {
      return
    }
    if (state !== 'STREAMING') {
      assert(state === 'UNSTARTED')
      return
    }
    buffer.forEach((chunk) => {
      assert(write)
      write(chunk)
    })
    buffer.length = 0
  }

  function createPipeWrapper(): Pipe {
    const pipeWrapper: Pipe = (writable: WritableType) => {
      // console.log('pipe() call')
      const writableProxy = new Writable({
        write(chunk: unknown, encoding, callback) {
          // console.log('react write')
          state = 'STREAMING'
          flushBuffer()
          writable.write(chunk, encoding, callback)
        },
        final(callback) {
          flushBuffer()
          state = 'ENDED'
          writable.end()
          callback()
        }
      })
      write = (chunk: string) => {
        writable.write(chunk)
      }
      ;(writableProxy as any).flush = () => {
        flushBuffer()
        if (typeof (writable as any).flush === 'function') {
          ;(writable as any).flush()
        }
      }
      pipeOriginal(writableProxy)
    }
    return pipeWrapper
  }
}

type Pipe = (writable: WritableType) => void
type StreamModule = {
  Readable: typeof ReadableType
  Writable: typeof WritableType
}

function loadStreamNodeModule(): StreamModule {
  const req = require // bypass static analysis of bundlers
  const streamModule = req('stream')
  const { Readable, Writable } = streamModule as StreamModule
  return { Readable, Writable }
}
