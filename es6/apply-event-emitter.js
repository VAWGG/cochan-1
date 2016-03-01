
export default function applyEventEmitter(emitter, outChan, closeOnError, closeOnEnd) {
  emitter.on('data', d => outChan.put(d))
  emitter.once('end', () => {
    emitter.removeAllListeners()
    closeOnEnd && outChan.close()
  })
  emitter.once('error', e => {
    closeOnError && emitter.removeAllListeners()
    outChan.putError(e, closeOnError)
  })
}
