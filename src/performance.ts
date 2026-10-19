import type { RepositoryAnalysis, RepositoryFile } from './types';

export const LARGE_REPOSITORY_FILE_THRESHOLD = 120;
export const LARGE_REPOSITORY_BYTE_THRESHOLD = 1_500_000;

export function repositoryBytes(files: RepositoryFile[]): number {
  return files.reduce((total, file) => total + file.size, 0);
}

export function isLargeRepositoryFiles(files: RepositoryFile[]): boolean {
  return files.length >= LARGE_REPOSITORY_FILE_THRESHOLD || repositoryBytes(files) >= LARGE_REPOSITORY_BYTE_THRESHOLD;
}

export function isLargeRepository(analysis: RepositoryAnalysis): boolean {
  return isLargeRepositoryFiles(analysis.files);
}
