// The import's decrypt and re-encrypt, in a Worker so the tab stays
// responsive through the longest operation in the product
// (spec/features/export-import.md, Export / import, The decryption wait).
//
// Every plaintext payload lives and dies here. The page receives the
// new DEK and ciphertext only, and ends the worker once it has them.
import { RecordUnreadable, rekey } from './transfer.js';

self.onmessage = async (event) => {
  const { fileDek, records } = event.data;
  try {
    const { dek, records: rekeyed } = await rekey(fileDek, records, (phase, done, total) =>
      self.postMessage({ phase, done, total }),
    );
    self.postMessage({ phase: 'done', dek, records: rekeyed });
  } catch (error) {
    self.postMessage({
      phase: 'failed',
      recordId: error instanceof RecordUnreadable ? error.recordId : null,
    });
  }
};
