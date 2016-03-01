
export default function applyStream(stream, outChan, closeOnError, closeOnEnd) {
  stream.on('data', d => outChan.put(d))
  stream.once('end', () => {
    stream.removeAllListeners()
    closeOnEnd && outChan.close()
  })
  stream.once('error', e => {
    closeOnError && stream.removeAllListeners()
    outChan.putError(e, closeOnError)
  })
}
