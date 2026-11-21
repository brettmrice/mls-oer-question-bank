import React, { useState } from 'react';
import { Download, FileCode, FileSpreadsheet, FileText, Printer } from 'lucide-react';
import { Button } from '@/components/ui/primitives';
import {
  sanitizeFilename,
  triggerBlobDownload,
  triggerTextDownload,
} from '@/lib/exporters/download';
import { buildAikenText } from '@/lib/exporters/exportAiken';
import { buildD2LCsv } from '@/lib/exporters/exportD2L';
import { buildDocxBlob } from '@/lib/exporters/exportDocx';
import { buildPrintableHtml, buildPrintableMarkdown } from '@/lib/exporters/exportPrintable';
import { buildQti12Zip, buildQti21Zip } from '@/lib/exporters/exportQTI';
import type { QuestionRecord } from '@/types/question';

export interface QuizExportButtonsProps {
  title: string;
  description?: string;
  questions: QuestionRecord[];
  customPoints?: Record<string, number>;
  disabled?: boolean;
}

export function QuizExportButtons({
  title,
  description = '',
  questions,
  customPoints = {},
  disabled = false,
}: QuizExportButtonsProps): React.ReactElement {
  const [includeAnswerKey, setIncludeAnswerKey] = useState(true);
  const [busyFormat, setBusyFormat] = useState<string | null>(null);

  const baseName = sanitizeFilename(title);
  const isDisabled = disabled || questions.length === 0 || busyFormat !== null;

  const handleD2L = () => {
    const csv = buildD2LCsv(questions, customPoints);
    triggerTextDownload(csv, `${baseName}_D2L.csv`, 'text/csv;charset=utf-8');
  };

  const handleAiken = () => {
    const txt = buildAikenText(questions);
    triggerTextDownload(txt, `${baseName}_Aiken.txt`, 'text/plain;charset=utf-8');
  };

  const handleQti12 = async () => {
    setBusyFormat('qti12');
    try {
      const blob = await buildQti12Zip(title, questions, customPoints);
      triggerBlobDownload(blob, `${baseName}_QTI_1.2.zip`);
    } finally {
      setBusyFormat(null);
    }
  };

  const handleQti21 = async () => {
    setBusyFormat('qti21');
    try {
      const blob = await buildQti21Zip(title, questions, customPoints);
      triggerBlobDownload(blob, `${baseName}_QTI_2.1.zip`);
    } finally {
      setBusyFormat(null);
    }
  };

  const handleDocx = async () => {
    setBusyFormat('docx');
    try {
      const blob = await buildDocxBlob(title, description, questions, customPoints);
      triggerBlobDownload(blob, `${baseName}.docx`);
    } finally {
      setBusyFormat(null);
    }
  };

  const handleMarkdown = () => {
    const md = buildPrintableMarkdown(title, questions, customPoints, includeAnswerKey);
    triggerTextDownload(md, `${baseName}.md`, 'text/markdown;charset=utf-8');
  };

  const handleHtml = () => {
    const html = buildPrintableHtml(title, questions, customPoints, includeAnswerKey);
    triggerTextDownload(html, `${baseName}_printable.html`, 'text/html;charset=utf-8');
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <Button variant="outline" size="sm" disabled={isDisabled} onClick={handleD2L}>
          <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
          D2L Brightspace (.csv)
        </Button>
        <Button variant="outline" size="sm" disabled={isDisabled} onClick={handleDocx}>
          <FileText className="h-3.5 w-3.5 text-blue-600" />
          {busyFormat === 'docx' ? 'Building .docx...' : 'Word Exam + Key (.docx)'}
        </Button>
        <Button variant="outline" size="sm" disabled={isDisabled} onClick={handleQti12}>
          <FileCode className="h-3.5 w-3.5 text-indigo-600" />
          {busyFormat === 'qti12' ? 'Zipping QTI 1.2...' : 'IMS QTI 1.2 (.zip)'}
        </Button>
        <Button variant="outline" size="sm" disabled={isDisabled} onClick={handleQti21}>
          <FileCode className="h-3.5 w-3.5 text-violet-600" />
          {busyFormat === 'qti21' ? 'Zipping QTI 2.1...' : 'IMS QTI 2.1 (.zip)'}
        </Button>
        <Button variant="outline" size="sm" disabled={isDisabled} onClick={handleAiken}>
          <Download className="h-3.5 w-3.5 text-amber-600" />
          Aiken Format (.txt)
        </Button>
        <Button variant="outline" size="sm" disabled={isDisabled} onClick={handleHtml}>
          <Printer className="h-3.5 w-3.5 text-slate-700" />
          Printable HTML
        </Button>
        <Button variant="outline" size="sm" disabled={isDisabled} onClick={handleMarkdown}>
          <FileText className="h-3.5 w-3.5 text-slate-600" />
          Printable Markdown (.md)
        </Button>
      </div>

      <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
        <input
          type="checkbox"
          checked={includeAnswerKey}
          onChange={(e) => setIncludeAnswerKey(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600"
        />
        <span>Include Answer Key &amp; Rationales in Printable HTML / Markdown exports</span>
      </label>
    </div>
  );
}
