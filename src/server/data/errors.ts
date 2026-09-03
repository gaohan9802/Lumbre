export class DataPathError extends Error {
  readonly code = 'DATA_PATH_INVALID'

  constructor(message: string) {
    super(message)
    this.name = 'DataPathError'
  }
}

export class DataFileNotFoundError extends Error {
  readonly code = 'DATA_FILE_NOT_FOUND'

  constructor(readonly filePath: string) {
    super(`Data file does not exist: ${filePath}`)
    this.name = 'DataFileNotFoundError'
  }
}

export class DataCorruptionError extends Error {
  readonly code = 'DATA_CORRUPT'

  constructor(readonly filePath: string, message = 'Data file is not valid JSON or has an invalid structure', options?: ErrorOptions) {
    super(`${message}: ${filePath}`, options)
    this.name = 'DataCorruptionError'
  }
}

export class DataLockTimeoutError extends Error {
  readonly code = 'DATA_LOCK_TIMEOUT'

  constructor(readonly targetPath: string) {
    super(`Timed out waiting for data lock: ${targetPath}`)
    this.name = 'DataLockTimeoutError'
  }
}
