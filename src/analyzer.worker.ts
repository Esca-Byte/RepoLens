import { analyzeRepository } from './analyzer';
import type { RepositoryFile } from './types';

type WorkerRequest = { files: RepositoryFile[]; name: string };

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { files, name } = event.data;
  self.postMessage({ type: 'progress', message: `Analyzing ${files.length.toLocaleString()} files in a background worker…` });
  const analysis = analyzeRepository(files, name);
  self.postMessage({ type: 'progress', message: `Built ${analysis.metrics.references.toLocaleString()} symbol references and ${analysis.metrics.relationships.toLocaleString()} relationships.` });
  self.postMessage({ type: 'complete', analysis });
};

export {};
