import JSZip from 'jszip';
import type { QuestionRecord } from '@/types/question';

function escapeXml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function safeXmlId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_');
  return /^[a-zA-Z_]/.test(cleaned) ? cleaned : `id_${cleaned}`;
}

export function buildQti12Xml(
  title: string,
  questions: QuestionRecord[],
  customPoints: Record<string, number> = {},
): { manifestXml: string; assessmentXml: string } {
  const assessmentId = safeXmlId(`mls_oer_${title.slice(0, 24)}`);

  const itemsXml = questions
    .map((q) => {
      const itemId = safeXmlId(q.id);
      const pts = customPoints[q.id] ?? 1;
      const correctOpt = q.options.find((o) => o.weight === 100) ?? q.options[0];
      const correctRespId = safeXmlId(`${q.id}_${correctOpt?.label ?? 'A'}`);

      const choicesXml = q.options
        .map((opt) => {
          const respId = safeXmlId(`${q.id}_${opt.label}`);
          return `
            <response_label ident="${respId}">
              <material><mattext texttype="text/plain">${escapeXml(opt.text)}</mattext></material>
            </response_label>`.trim();
        })
        .join('\n');

      const feedbacksXml = q.options
        .map((opt) => {
          const fbId = safeXmlId(`fb_${q.id}_${opt.label}`);
          return `
        <itemfeedback ident="${fbId}">
          <flow_mat><material><mattext texttype="text/plain">${escapeXml(opt.feedback || '')}</mattext></material></flow_mat>
        </itemfeedback>`.trim();
        })
        .join('\n');

      return `
      <item ident="${itemId}" title="${escapeXml(q.displayId)}">
        <itemmetadata>
          <qtimetadata>
            <qtimetadatafield>
              <fieldlabel>question_type</fieldlabel>
              <fieldentry>multiple_choice_question</fieldentry>
            </qtimetadatafield>
            <qtimetadatafield>
              <fieldlabel>points_possible</fieldlabel>
              <fieldentry>${pts}</fieldentry>
            </qtimetadatafield>
          </qtimetadata>
        </itemmetadata>
        <presentation>
          <material>
            <mattext texttype="text/plain">${escapeXml(q.questionText)}</mattext>
          </material>
          <response_lid ident="response1" rcardinality="Single">
            <render_choice>
              ${choicesXml}
            </render_choice>
          </response_lid>
        </presentation>
        <resprocessing>
          <outcomes>
            <decvar maxvalue="100" minvalue="0" varname="SCORE" vartype="Decimal"/>
          </outcomes>
          <respcondition continue="No">
            <conditionvar>
              <varequal respident="response1">${correctRespId}</varequal>
            </conditionvar>
            <setvar action="Set" varname="SCORE">100</setvar>
          </respcondition>
        </resprocessing>
        ${feedbacksXml}
      </item>`.trim();
    })
    .join('\n');

  const assessmentXml = `<?xml version="1.0" encoding="UTF-8"?>
<questestinterop xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2">
  <assessment ident="${assessmentId}" title="${escapeXml(title)}">
    <qtimetadata>
      <qtimetadatafield>
        <fieldlabel>cc_license</fieldlabel>
        <fieldentry>CC0-1.0</fieldentry>
      </qtimetadatafield>
    </qtimetadata>
    <section ident="root_section">
      ${itemsXml}
    </section>
  </assessment>
</questestinterop>
`;

  const manifestXml = `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="man_${assessmentId}" xmlns="http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1">
  <metadata>
    <schema>IMS Content</schema>
    <schemaversion>1.1.3</schemaversion>
  </metadata>
  <organizations/>
  <resources>
    <resource identifier="res_${assessmentId}" type="imsqti_xmlv1p2" href="assessment.xml">
      <file href="assessment.xml"/>
    </resource>
  </resources>
</manifest>
`;

  return { manifestXml, assessmentXml };
}

export async function buildQti12Zip(
  title: string,
  questions: QuestionRecord[],
  customPoints: Record<string, number> = {},
): Promise<Blob> {
  const { manifestXml, assessmentXml } = buildQti12Xml(title, questions, customPoints);
  const zip = new JSZip();
  zip.file('imsmanifest.xml', manifestXml);
  zip.file('assessment.xml', assessmentXml);
  return zip.generateAsync({ type: 'blob' });
}

export function buildQti21PackageFiles(
  title: string,
  questions: QuestionRecord[],
  customPoints: Record<string, number> = {},
): {
  manifestXml: string;
  assessmentTestXml: string;
  items: Array<{ href: string; xml: string }>;
} {
  const testId = safeXmlId(`test_${title.slice(0, 24)}`);
  const items: Array<{ href: string; xml: string; itemId: string; pts: number }> =
    questions.map((q) => {
      const itemId = safeXmlId(q.id);
      const pts = customPoints[q.id] ?? 1;
      const correctOpt = q.options.find((o) => o.weight === 100) ?? q.options[0];
      const correctId = safeXmlId(`opt_${correctOpt?.label ?? 'A'}`);

      const choicesXml = q.options
        .map((opt) => {
          const optId = safeXmlId(`opt_${opt.label}`);
          return `<simpleChoice identifier="${optId}">${escapeXml(opt.text)}</simpleChoice>`;
        })
        .join('\n        ');

      const feedbackBlocks = q.options
        .filter((o) => o.feedback)
        .map((opt) => {
          const optId = safeXmlId(`opt_${opt.label}`);
          return `<modalFeedback outcomeIdentifier="FEEDBACK" identifier="${optId}" showHide="show">${escapeXml(opt.label + ') ' + opt.feedback)}</modalFeedback>`;
        })
        .join('\n  ');

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<assessmentItem xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1"
  identifier="${itemId}"
  title="${escapeXml(q.displayId)}"
  adaptive="false"
  timeDependent="false">
  <responseDeclaration identifier="RESPONSE" cardinality="single" baseType="identifier">
    <correctResponse>
      <value>${correctId}</value>
    </correctResponse>
  </responseDeclaration>
  <outcomeDeclaration identifier="SCORE" cardinality="single" baseType="float">
    <defaultValue><value>0</value></defaultValue>
  </outcomeDeclaration>
  <outcomeDeclaration identifier="MAXSCORE" cardinality="single" baseType="float">
    <defaultValue><value>${pts}</value></defaultValue>
  </outcomeDeclaration>
  <outcomeDeclaration identifier="FEEDBACK" cardinality="single" baseType="identifier"/>
  <itemBody>
    <p>${escapeXml(q.questionText)}</p>
    <choiceInteraction responseIdentifier="RESPONSE" shuffle="false" maxChoices="1">
      ${choicesXml}
    </choiceInteraction>
  </itemBody>
  <responseProcessing template="http://www.imsglobal.org/question/qti_v2p1/rptemplates/match_correct"/>
  ${feedbackBlocks}
</assessmentItem>
`;
      return { href: `items/${itemId}.xml`, xml, itemId, pts };
    });

  const itemRefsXml = items
    .map(
      (it) =>
        `<assessmentItemRef identifier="ref_${it.itemId}" href="${it.href}"><weight identifier="WEIGHT" value="${it.pts}"/></assessmentItemRef>`,
    )
    .join('\n      ');

  const assessmentTestXml = `<?xml version="1.0" encoding="UTF-8"?>
<assessmentTest xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1"
  identifier="${testId}"
  title="${escapeXml(title)}">
  <outcomeDeclaration identifier="SCORE" cardinality="single" baseType="float">
    <defaultValue><value>0</value></defaultValue>
  </outcomeDeclaration>
  <testPart identifier="part1" navigationMode="linear" submissionMode="individual">
    <assessmentSection identifier="section1" title="${escapeXml(title)}" visible="true">
      ${itemRefsXml}
    </assessmentSection>
  </testPart>
</assessmentTest>
`;

  const resourceItemsXml = items
    .map(
      (it) =>
        `<resource identifier="res_${it.itemId}" type="imsqti_item_xmlv2p1" href="${it.href}"><file href="${it.href}"/></resource>`,
    )
    .join('\n    ');

  const manifestXml = `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="man_${testId}" xmlns="http://www.imsglobal.org/xsd/imscp_v1p1">
  <metadata>
    <schema>QTIv2.1 Package</schema>
    <schemaversion>2.1</schemaversion>
  </metadata>
  <organizations/>
  <resources>
    <resource identifier="res_${testId}" type="imsqti_test_xmlv2p1" href="assessmentTest.xml">
      <file href="assessmentTest.xml"/>
      ${items.map((it) => `<dependency identifierref="res_${it.itemId}"/>`).join('\n      ')}
    </resource>
    ${resourceItemsXml}
  </resources>
</manifest>
`;

  return {
    manifestXml,
    assessmentTestXml,
    items: items.map(({ href, xml }) => ({ href, xml })),
  };
}

export async function buildQti21Zip(
  title: string,
  questions: QuestionRecord[],
  customPoints: Record<string, number> = {},
): Promise<Blob> {
  const pkg = buildQti21PackageFiles(title, questions, customPoints);
  const zip = new JSZip();
  zip.file('imsmanifest.xml', pkg.manifestXml);
  zip.file('assessmentTest.xml', pkg.assessmentTestXml);
  for (const item of pkg.items) {
    zip.file(item.href, item.xml);
  }
  return zip.generateAsync({ type: 'blob' });
}
