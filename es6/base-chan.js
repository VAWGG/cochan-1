
export default class BaseChan
{
  take() {
    return new Promise((res, rej) => this._take(res, rej, false))
  }

  then(fnVal, fnErr) {
    return new Promise((resolve, reject) => {
      this._take(
        (v) => {
          if (!fnVal) {
            return resolve(v)
          }
          try {
            resolve(fnVal(v))
          } catch (err) {
            if (!fnErr) {
              return reject(err)
            }
            try {
              resolve(fnErr(err))
            } catch (err2) {
              reject(err2)
            }
          }
        },
        (e) => {
          if (!fnErr) {
            return reject(e)
          }
          try {
            resolve(fnErr(e))
          } catch (err) {
            reject(err)
          }
        }
      )
    })
  }

  catch(fnErr) {
    return this.then(undefined, fnErr)
  }
}
