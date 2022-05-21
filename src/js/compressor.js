class Compressor {
  /**
   * The filename to give the Zip file
   * @param filename
   */
  constructor(filename) {
    /**
     * Whether this zip has been closed off, no more files can be added and is ready for download.
     * @type {boolean}
     */
    this.closed = false;
    /**
     * The filename of this zip.
     * @type {string}
     */
    this.filename = filename;
    /**
     * The zip itself.
     * @type {Zip|Zip2}
     * @see {@link https://github.com/101arrowz/fflate}
     */
    this.zip = new Zip();
    /**
     * The ReadableStream version of the zip.
     * @type {ReadableStream<any>}
     */
    this.zipReadableStream = this.fflToRS(this.zip);
  }

  /**
   * The filesize to switch between syncronous and asyncronous compression. ~490KB
   * @type {number}
   */
  static LargeFileSize = 500000;

  /**
   * Add a file to the zip.
   * @param {File} file - The file to be added. See [File]{@link https://developer.mozilla.org/en-US/docs/Web/API/File}
   * @param {string} filename - The filename to use. Use forward slashes for subdirectories. Will use the filename from the provided File as a fallback.
   */
  async AddFileToZip(file, filename = '') {
    if (this.closed) {
      throw new Error(
        `Cannot add to ${this.filename} as it has been completed. Ensure .Complete() is not called first.`
      );
    }

    const fname = filename.trim() || file.webkitRelativePath || file.name;
    const ext = fname.slice(fname.lastIndexOf('.') + 1);
    const zippedFileStream = Compressor.IncompressibleTypes.has(ext)
      ? new ZipPassThrough(filename)
      : file.size > Compressor.LargeFileSize
      ? new AsyncZipDeflate(filename, { level: 9 })
      : new ZipDeflate(filename, { level: 9 });
    zippedFileStream.mtime = file.lastModified;
    zippedFileStream.filename = fname;
    this.zip.add(zippedFileStream);
    const fileReader = file.stream().getReader();
    while (true) {
      const { done, value } = await fileReader.read();
      if (done) {
        zippedFileStream.push(new Uint8Array(0), true);
        break;
      }
      zippedFileStream.push(value);
    }
  }

  /**
   * Add a file URL to download and then add to the zip.
   * @param {RequestInfo} url - The URL to download and add to the Zip
   * @param {string} filename - The filename to use. Use forward slashes for subdirectories.
   * @return {Promise<void>}
   */
  async AddFileURLToZip(url, filename = url) {
    if (this.closed) {
      throw new Error(
        `Cannot add to ${this.filename} as it has been completed. Ensure .Complete() is not called first.`
      );
    }

    try {
      let file = await fetch(url)
        .then((r) => r.blob())
        .then(
          (blobFile) => new File([blobFile], filename, { type: blobFile.type })
        );
      await this.AddFileToZip(file, filename);
    } catch (e) {
      console.error(`Error adding file URL to zip ${this.filename}`, e);
    }
  }

  /**
   * Add a binary file blob to the zip.
   * @param {Blob} blob - The binary file blob. {@see https://developer.mozilla.org/en-US/docs/Web/API/Blob}
   * @param {string} filename - The filename to use. Use forward slashes for subdirectories.
   */
  async AddBlobToZip(blob, filename) {
    const file = new File([blob], filename, { type: blob.type });
    await this.AddFileToZip(file, filename);
  }

  /**
   * Add a string file to the zip.
   * @param {string} data - The UTF8 string to compress.
   * @param {string} filename - The filename to use. Use forward slashes for subdirectories.
   */
  AddStringToZip(data, filename) {
    if (this.closed) {
      throw new Error(
        `Cannot add to ${this.filename} as it has been completed. Ensure .Complete() is not called first.`
      );
    }

    const zippedStream =
      data.length > Compressor.LargeFileSize
        ? new AsyncZipDeflate(filename, { level: 9 })
        : new ZipDeflate(filename, { level: 9 });
    zippedStream.filename = filename;
    this.zip.add(zippedStream);
    zippedStream.push(strToU8(data), true);
  }

  /**
   * Add to the zip.
   * @param {any} data - The value to compress. This could be a string, object, array etc. Anything that can be JSON stringified.
   * @param {string} filename - The filename to use. Use forward slashes for subdirectories.
   */
  AddToZip(data, filename) {
    if (this.closed) {
      throw new Error(
        `Cannot add to ${this.filename} as it has been completed. Ensure .Complete() is not called first.`
      );
    }

    if (typeof data.toObject === 'function') {
      return this.AddStringToZip(JSON.stringify(data.toObject()), filename);
    } else if (typeof data.toJSON === 'function') {
      return this.AddStringToZip(JSON.stringify(data.toJSON()), filename);
    }
    this.AddStringToZip(JSON.stringify(data), filename);
  }

  /**
   * Complete the compression of the zip. This _must_ be called after adding all desired files
   * for the resulting ZIP file to work properly.
   */
  Complete() {
    if (this.closed) {
      return;
    }

    this.zip.end();
    this.closed = true;
  }

  /**
   * Cancel the creation of the zip. Subsequent calls to add will fail.
   */
  Cancel() {
    this.zip.terminate();
  }

  /**
   * Download the zipped file.
   */
  async Download() {
    if (!this.closed) {
      throw new Error(
        `Cannot download ${this.filename} as it has not been completed. Ensure .Complete() is called first.`
      );
    }

    const blob = await this.ToBlob();
    if (typeof window.navigator.msSaveBlob !== 'undefined') {
      // IE doesn't allow using a blob object directly as link href.
      // Workaround for "HTML7007: One or more blob URLs were
      // revoked by closing the blob for which they were created.
      // These URLs will no longer resolve as the data backing
      // the URL has been freed."
      window.navigator.msSaveBlob(blob, this.filename);
      return;
    }

    // Create a link pointing to the ObjectURL containing the blob
    const blobURL = URL.createObjectURL(blob);
    const tempLink = document.createElement('a');
    tempLink.style.display = 'none';
    tempLink.setAttribute('href', blobURL);
    tempLink.setAttribute('download', this.filename);
    // Safari thinks _blank anchor are pop ups. We only want to set _blank
    // target if the browser does not support the HTML5 download attribute.
    // This allows you to download files in desktop safari if pop up blocking
    // is enabled.
    if (typeof tempLink.download === 'undefined') {
      tempLink.setAttribute('target', '_blank');
    }
    tempLink.click();

    setTimeout(() => {
      // For Firefox it is necessary to delay revoking the ObjectURL
      URL.revokeObjectURL(blobURL);
    }, 200);
  }

  /**
   * Convert the current zip file into a [Blob]{@link https://developer.mozilla.org/en-US/docs/Web/API/Blob}
   * @return {Blob}
   */
  async ToBlob() {
    if (!this.closed) {
      throw new Error(
        `Cannot create a blog of ${this.filename} as it has not been completed. Ensure .Complete() is called first.`
      );
    }

    const zipResponse = new Response(this.zipReadableStream);
    return await zipResponse.blob();
  }

  /**
   * File extensions that should not be compressed as they are already compressed.
   * @type {Set<string>}
   */
  static IncompressibleTypes = new Set([
    'png',
    'jpg',
    'jpeg',
    'pdf',
    'heic',
    'heif',
    'gif',
    'webp',
    'webm',
    'mp4',
    'mov',
    'mp3',
    'aifc',
  ]);

  /**
   * Convert a fflate to a ReadableStream
   * @param fflateStream
   * @return {ReadableStream<any>}
   */
  fflToRS = (fflateStream) =>
    new ReadableStream({
      start(controller) {
        fflateStream.ondata = (err, data, final) => {
          if (err) {
            controller.error(err);
          } else {
            controller.enqueue(data);
            if (final) {
              controller.close();
            }
          }
        };
      },
      cancel() {
        fflateStream.terminate();
      },
    });

  /**
   * Calculates the size of the files inside the provided zips.
   * @param {Compressor[]} files
   * @return {{uncompressed: number, compressed: number}}
   */
  static CalculateSize(files) {
    let compressed = 0;
    let uncompressed = 0;
    for (const file of files) {
      for (const el of file?.zip?.u) {
        if (typeof el.c === 'number') {
          compressed += el.c;
        }
        if (typeof el.size === 'number') {
          uncompressed += el.size;
        }
      }
    }
    return { compressed, uncompressed };
  }
}
