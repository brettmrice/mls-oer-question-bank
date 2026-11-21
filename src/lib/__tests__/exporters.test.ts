import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { buildAikenText } from '@/lib/exporters/exportAiken';
import { buildD2LCsv } from '@/lib/exporters/exportD2L';
import { buildDocxBlob } from '@/lib/exporters/exportDocx';
import { buildPrintableHtml, buildPrintableMarkdown } from '@/lib/exporters/exportPrintable';
import { buildQti12Zip, buildQti21Zip } from '@/lib/exporters/exportQTI';
import type { QuestionRecord } from '@/types/question';

function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'));
    reader.readAsArrayBuffer(blob);
  });
}

const SAMPLE_QUESTIONS: QuestionRecord[] = [
  {
    id: 'q_8f3a1c92b4d0',
    displayId: 'BB_01-AN-0001',
    disciplineCode: 'BB',
    disciplineName: 'Blood Banking',
    topicCode: 'BB_01',
    topicName: 'Blood Products',
    taxonomicCode: 'BB_01-A-01',
    ascpSubtopic: 'Donors',
    leafTopic: 'Qualification',
    ascpPath: 'Blood Banking > Blood Products > Donors > Qualification',
    subsetTags: ['Core_Pool', 'A1_EE-A1'],
    bloomLevel: 'AN',
    difficulty: 5,
    difficultyRationale: 'Evaluate physiological bradycardia.',
    questionType: 'MC',
    objective: 'Assess conditioned athlete pulse deferral rules.',
    questionText: 'An asymptomatic marathon runner has a pulse of 46 bpm. What action is required?',
    options: [
      {
        label: 'A',
        text: 'Permanent deferral',
        weight: 0,
        feedback: 'Incorrect: Sinus bradycardia in athletes is physiological.',
      },
      {
        label: 'B',
        text: 'Qualify upon medical director approval',
        weight: 100,
        feedback: 'Correct: Bradycardia (<50 bpm) in athletes requires medical director approval.',
      },
    ],
    hint: 'Consider high vagal tone in athletes.',
    similarIds: [],
    sourceFiles: ['BB/BB_01/BB_01-Blood-Products_MC_AN.md'],
  },
];

describe('exporters', () => {
  it('generates 5-column D2L Brightspace CSV matching _D2L_Exit_Exam parity', () => {
    const csv = buildD2LCsv(SAMPLE_QUESTIONS, { q_8f3a1c92b4d0: 2 });
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('NewQuestion,MC,,,');
    expect(lines[1]).toBe('ID,BB_01-AN-0001,,,');
    expect(lines[4]).toBe('Points,2,,,');
    expect(lines[6]).toBe('Image,,,,');
    expect(lines).toContain(
      'Option,100,Qualify upon medical director approval,,Correct: Bradycardia (<50 bpm) in athletes requires medical director approval.',
    );
    expect(lines[lines.length - 1]).toBe('Feedback,,,,');
  });

  it('generates valid IMS QTI 1.2 and QTI 2.1 .zip packages', async () => {
    const blob12 = await buildQti12Zip('BB Midterm', SAMPLE_QUESTIONS, { q_8f3a1c92b4d0: 3 });
    const zip12 = await JSZip.loadAsync(await blobToArrayBuffer(blob12));
    const manifest12 = await zip12.file('imsmanifest.xml')!.async('string');
    const assess12 = await zip12.file('assessment.xml')!.async('string');
    expect(manifest12).toContain('imsqti_xmlv1p2');
    expect(assess12).toContain('<questestinterop');
    expect(assess12).toContain('marathon runner');
    expect(assess12).toContain('q_8f3a1c92b4d0_B');

    const blob21 = await buildQti21Zip('BB Midterm', SAMPLE_QUESTIONS, { q_8f3a1c92b4d0: 3 });
    const zip21 = await JSZip.loadAsync(await blobToArrayBuffer(blob21));
    const manifest21 = await zip21.file('imsmanifest.xml')!.async('string');
    const test21 = await zip21.file('assessmentTest.xml')!.async('string');
    const item21 = await zip21.file('items/q_8f3a1c92b4d0.xml')!.async('string');
    expect(manifest21).toContain('imsqti_test_xmlv2p1');
    expect(test21).toContain('<assessmentTest');
    expect(item21).toContain('<assessmentItem');
    expect(item21).toContain('<value>opt_B</value>');
  });

  it('generates strict Aiken format text', () => {
    const aiken = buildAikenText(SAMPLE_QUESTIONS);
    expect(aiken).toContain('An asymptomatic marathon runner has a pulse of 46 bpm. What action is required?\n');
    expect(aiken).toContain('A. Permanent deferral\n');
    expect(aiken).toContain('B. Qualify upon medical director approval\n');
    expect(aiken).toContain('ANSWER: B');
  });

  it('generates a readable Word .docx containing student exam and answer key', async () => {
    const blob = await buildDocxBlob('Fall Exam', 'BB Review', SAMPLE_QUESTIONS);
    const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob));
    const docXml = await zip.file('word/document.xml')!.async('string');
    expect(docXml).toContain('Fall Exam');
    expect(docXml).toContain('An asymptomatic marathon runner');
    expect(docXml).toContain('Educator Answer Key');
    expect(docXml).toContain('Answer: B');
  });

  it('generates printable Markdown and HTML with CC0 1.0 headers', () => {
    const md = buildPrintableMarkdown('Quiz One', SAMPLE_QUESTIONS, {}, true);
    expect(md).toContain('# Quiz One');
    expect(md).toContain('CC0 1.0');
    expect(md).toContain('Answer: B');

    const html = buildPrintableHtml('Quiz One', SAMPLE_QUESTIONS, {}, false);
    expect(html).toContain('<title>Quiz One — MLS OER</title>');
    expect(html).not.toContain('Answer Key');
  });
});
