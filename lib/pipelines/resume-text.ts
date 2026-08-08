/**
 * Resume text extraction.
 *
 * Runs server-side so the browser never has to ship a PDF parser, and so the
 * text the agents see is exactly the text we stored.
 */

import { extractText, getDocumentProxy } from 'unpdf';

/**
 * `Math.sumPrecise` polyfill.
 *
 * The PDF.js build inside unpdf calls it for layout arithmetic. It is a recent
 * TC39 proposal that this Node build does not ship, so every page emits
 * `TypeError: Math.sumPrecise is not a function`. PDF.js swallows the throw and
 * carries on, which is why extraction still works — but it does so with degraded
 * numbers, and it buries real errors under dozens of warnings.
 *
 * Neumaier summation: tracks the low-order bits that plain accumulation drops,
 * which is the precision guarantee the real method makes.
 */
if (typeof (Math as { sumPrecise?: unknown }).sumPrecise !== 'function') {
  (Math as unknown as { sumPrecise: (values: Iterable<number>) => number }).sumPrecise = (
    values: Iterable<number>,
  ): number => {
    let sum = 0;
    let compensation = 0;

    for (const value of values) {
      const next = sum + value;
      compensation +=
        Math.abs(sum) >= Math.abs(value) ? sum - next + value : value - next + sum;
      sum = next;
    }

    return sum + compensation;
  };
}

export class ResumeExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResumeExtractionError';
  }
}

export interface ExtractedResume {
  text: string;
  pageCount: number;
}

export async function extractResumeText(file: ArrayBuffer): Promise<ExtractedResume> {
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(file));
  } catch {
    throw new ResumeExtractionError('That file could not be read as a PDF.');
  }

  const { text, totalPages } = await extractText(pdf, { mergePages: true });
  const merged = (Array.isArray(text) ? text.join('\n') : text).replace(/\s+\n/g, '\n').trim();

  // A scanned resume parses to almost nothing. Saying so is far better than
  // letting P2 hallucinate a profile from three stray characters.
  if (merged.length < 200) {
    throw new ResumeExtractionError(
      'We could not read any text from that PDF. If it is a scan or an image, export a text-based PDF and try again.',
    );
  }

  return { text: merged, pageCount: totalPages };
}
