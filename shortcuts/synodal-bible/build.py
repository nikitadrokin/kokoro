#!/usr/bin/env python3
"""Build an unsigned Synodal Bible.shortcut for iOS/macOS Shortcuts.

Usage:
  python3 build.py

Sign on a Mac:
  shortcuts sign --mode anyone \\
    --input "Synodal Bible.shortcut" \\
    --output ~/Downloads/Synodal\\ Bible.shortcut
"""

from __future__ import annotations

import base64
import json
import plistlib
import re
import uuid
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
JS_PATH = ROOT / 'lookup.js'
ABBR_PATH = ROOT / 'abbr-map.json'
OUT_PATH = ROOT / 'Synodal Bible.shortcut'

# Object Replacement Character used by Shortcuts variable tokens
ORC = '\ufffc'


def uid() -> str:
    return str(uuid.uuid4()).upper()


def token_string(text: str, attachments: dict[str, dict[str, Any]]) -> dict[str, Any]:
    return {
        'Value': {
            'string': text,
            'attachmentsByRange': attachments,
        },
        'WFSerializationType': 'WFTextTokenString',
    }


def token_attachment(
    output_uuid: str | None = None,
    output_name: str | None = None,
    variable_name: str | None = None,
    type_name: str = 'ActionOutput',
    aggrandizements: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    value: dict[str, Any] = {'Type': type_name}
    if output_uuid is not None:
        value['OutputUUID'] = output_uuid
    if output_name is not None:
        value['OutputName'] = output_name
    if variable_name is not None:
        value['VariableName'] = variable_name
        if type_name == 'ActionOutput':
            value['Type'] = 'Variable'
    if aggrandizements:
        value['Aggrandizements'] = aggrandizements
    return {
        'Value': value,
        'WFSerializationType': 'WFTextTokenAttachment',
    }


def action(identifier: str, params: dict[str, Any]) -> dict[str, Any]:
    return {
        'WFWorkflowActionIdentifier': identifier,
        'WFWorkflowActionParameters': params,
    }


def coerce_string() -> list[dict[str, Any]]:
    return [
        {
            'Type': 'WFCoercionVariableAggrandizement',
            'CoercionItemClass': 'WFStringContentItem',
        }
    ]


def coerce_rich_text() -> list[dict[str, Any]]:
    return [
        {
            'Type': 'WFCoercionVariableAggrandizement',
            'CoercionItemClass': 'WFRichTextContentItem',
        }
    ]


def prepare_js(source: str, abbr_map: dict[str, Any]) -> str:
    js = re.sub(r'\nif \(typeof module[\s\S]*$', '\n', source).strip()
    if '#' in js:
        raise SystemExit('lookup.js must not contain # (breaks data URIs on iOS)')
    abbr_literal = json.dumps(abbr_map, ensure_ascii=False, separators=(',', ':'))
    # Inject map after the file header comment block
    injection = f'var ABBR_MAP={abbr_literal};\n'
    return injection + js


def data_uri_text(mode: str, encoded_uuid: str, encoded_name: str, js_b64: str) -> dict[str, Any]:
    """Build Text action whose value is a data:text/html runner."""
    # Placeholder for encoded input sits inside decodeURIComponent("...")
    prefix = (
        'data:text/html;charset=utf-8,<body/><script>'
        f'var __mode="{mode}";'
        'var __t=decodeURIComponent("'
    )
    suffix = f'");eval(atob("{js_b64}"));</script>'
    text = prefix + ORC + suffix
    # ORC is at index len(prefix)
    attachments = {
        f'{{{len(prefix)}, 1}}': {
            'OutputUUID': encoded_uuid,
            'OutputName': encoded_name,
            'Type': 'ActionOutput',
        }
    }
    return token_string(text, attachments)


def build() -> None:
    abbr_map = json.loads(ABBR_PATH.read_text(encoding='utf-8'))
    js_source = prepare_js(JS_PATH.read_text(encoding='utf-8'), abbr_map)
    js_b64 = base64.b64encode(js_source.encode('utf-8')).decode('ascii')

    # Stable-ish UUIDs for readability in diffs
    ask_uuid = 'A1000000-0000-4000-8000-000000000001'
    enc_ref_uuid = 'A1000000-0000-4000-8000-000000000002'
    parse_page_uuid = 'A1000000-0000-4000-8000-000000000003'
    parse_url_uuid = 'A1000000-0000-4000-8000-000000000004'
    parsed_uuid = 'A1000000-0000-4000-8000-000000000005'
    error_msg_uuid = 'A1000000-0000-4000-8000-000000000006'
    split_uuid = 'A1000000-0000-4000-8000-000000000007'
    code_uuid = 'A1000000-0000-4000-8000-000000000010'
    file_uuid = 'A1000000-0000-4000-8000-000000000011'
    title_uuid = 'A1000000-0000-4000-8000-000000000012'
    chap_uuid = 'A1000000-0000-4000-8000-000000000013'
    v1_uuid = 'A1000000-0000-4000-8000-000000000014'
    v2_uuid = 'A1000000-0000-4000-8000-000000000015'
    display_uuid = 'A1000000-0000-4000-8000-000000000016'
    getfile_uuid = 'A1000000-0000-4000-8000-000000000020'
    payload_uuid = 'A1000000-0000-4000-8000-000000000021'
    enc_payload_uuid = 'A1000000-0000-4000-8000-000000000022'
    extract_page_uuid = 'A1000000-0000-4000-8000-000000000023'
    extract_url_uuid = 'A1000000-0000-4000-8000-000000000024'
    body_uuid = 'A1000000-0000-4000-8000-000000000025'
    result_uuid = 'A1000000-0000-4000-8000-000000000026'
    bible_root_text_uuid = 'A1000000-0000-4000-8000-000000000030'
    clipboard_uuid = 'A1000000-0000-4000-8000-000000000031'
    input_if_group = 'B1000000-0000-4000-8000-0000000000IN'
    clipboard_if_group = 'B1000000-0000-4000-8000-0000000000CB'
    if_group = 'B1000000-0000-4000-8000-0000000000IF'

    actions: list[dict[str, Any]] = []

    actions.append(
        action(
            'is.workflow.actions.comment',
            {
                'WFCommentActionText': (
                    'Edit the BibleRoot Text action below if your clone is not at '
                    'Downloads/russian-synodal-bible. Input priority: Shortcut Input '
                    '(selected/shared text), then Clipboard, then Ask. Success and '
                    'errors both copy to the clipboard (no alert).'
                ),
            },
        )
    )

    # --- Configurable path (edit this Text to point at your clone) ---
    actions.append(
        action(
            'is.workflow.actions.gettext',
            {
                'UUID': bible_root_text_uuid,
                'CustomOutputName': 'BibleRootText',
                'WFTextActionText': 'Downloads/russian-synodal-bible',
            },
        )
    )
    actions.append(
        action(
            'is.workflow.actions.setvariable',
            {
                'WFVariableName': 'BibleRoot',
                'WFInput': token_attachment(bible_root_text_uuid, 'BibleRootText'),
            },
        )
    )

    # --- Input: Shortcut Input → Clipboard → Ask ---
    actions.append(
        action(
            'is.workflow.actions.conditional',
            {
                'GroupingIdentifier': input_if_group,
                'WFControlFlowMode': 0,
                'WFCondition': 'Has Any Value',
                'WFInput': {
                    'Value': {
                        'Type': 'ExtensionInput',
                        'VariableName': 'ShortcutInput',
                    },
                    'WFSerializationType': 'WFTextTokenAttachment',
                },
            },
        )
    )
    actions.append(
        action(
            'is.workflow.actions.gettext',
            {
                'UUID': 'A1000000-0000-4000-8000-0000000000A0',
                'CustomOutputName': 'ReferenceFromInput',
                'WFTextActionText': token_string(
                    ORC,
                    {
                        '{0, 1}': {
                            'Type': 'ExtensionInput',
                            'VariableName': 'ShortcutInput',
                        }
                    },
                ),
            },
        )
    )
    actions.append(
        action(
            'is.workflow.actions.setvariable',
            {
                'WFVariableName': 'Reference',
                'WFInput': token_attachment(
                    'A1000000-0000-4000-8000-0000000000A0',
                    'ReferenceFromInput',
                ),
            },
        )
    )
    actions.append(
        action(
            'is.workflow.actions.conditional',
            {
                'GroupingIdentifier': input_if_group,
                'WFControlFlowMode': 1,
            },
        )
    )

    # No Shortcut Input: try Clipboard magic variable / Get Clipboard
    actions.append(
        action(
            'is.workflow.actions.getclipboard',
            {
                'UUID': clipboard_uuid,
                'CustomOutputName': 'ClipboardText',
            },
        )
    )
    actions.append(
        action(
            'is.workflow.actions.conditional',
            {
                'GroupingIdentifier': clipboard_if_group,
                'WFControlFlowMode': 0,
                'WFCondition': 'Has Any Value',
                'WFInput': token_attachment(clipboard_uuid, 'ClipboardText'),
            },
        )
    )
    actions.append(
        action(
            'is.workflow.actions.setvariable',
            {
                'WFVariableName': 'Reference',
                'WFInput': token_attachment(clipboard_uuid, 'ClipboardText'),
            },
        )
    )
    actions.append(
        action(
            'is.workflow.actions.conditional',
            {
                'GroupingIdentifier': clipboard_if_group,
                'WFControlFlowMode': 1,
            },
        )
    )
    actions.append(
        action(
            'is.workflow.actions.ask',
            {
                'UUID': ask_uuid,
                'CustomOutputName': 'ReferenceAsked',
                'WFAskActionPrompt': 'Библейская ссылка (напр. Ин 3:16)',
                'WFInputType': 'Text',
            },
        )
    )
    actions.append(
        action(
            'is.workflow.actions.setvariable',
            {
                'WFVariableName': 'Reference',
                'WFInput': token_attachment(ask_uuid, 'ReferenceAsked'),
            },
        )
    )
    actions.append(
        action(
            'is.workflow.actions.conditional',
            {
                'UUID': uid(),
                'GroupingIdentifier': clipboard_if_group,
                'WFControlFlowMode': 2,
            },
        )
    )
    actions.append(
        action(
            'is.workflow.actions.conditional',
            {
                'UUID': uid(),
                'GroupingIdentifier': input_if_group,
                'WFControlFlowMode': 2,
            },
        )
    )

    actions.append(
        action(
            'is.workflow.actions.urlencode',
            {
                'UUID': enc_ref_uuid,
                'CustomOutputName': 'EncodedRef',
                'WFEncodeMode': 'Encode',
                'WFInput': token_string(
                    ORC,
                    {
                        '{0, 1}': {
                            'Type': 'Variable',
                            'VariableName': 'Reference',
                        }
                    },
                ),
            },
        )
    )

    actions.append(
        action(
            'is.workflow.actions.gettext',
            {
                'UUID': parse_page_uuid,
                'CustomOutputName': 'ParsePage',
                'WFTextActionText': data_uri_text('parse', enc_ref_uuid, 'EncodedRef', js_b64),
            },
        )
    )

    actions.append(
        action(
            'is.workflow.actions.setvariable',
            {
                'WFVariableName': 'ParsePage',
                'WFInput': token_attachment(parse_page_uuid, 'ParsePage'),
            },
        )
    )

    actions.append(
        action(
            'is.workflow.actions.url',
            {
                'UUID': parse_url_uuid,
                'CustomOutputName': 'ParseURL',
                'Show-WFURLActionURL': True,
                'WFURLActionURL': token_string(
                    ORC,
                    {
                        '{0, 1}': {
                            'Type': 'Variable',
                            'VariableName': 'ParsePage',
                        }
                    },
                ),
            },
        )
    )

    actions.append(
        action(
            'is.workflow.actions.urlencode',
            {
                'UUID': parsed_uuid,
                'CustomOutputName': 'Parsed',
                'WFEncodeMode': 'Decode',
                'WFInput': token_string(
                    ORC,
                    {
                        '{0, 1}': {
                            'OutputUUID': parse_url_uuid,
                            'OutputName': 'ParseURL',
                            'Type': 'ActionOutput',
                            'Aggrandizements': coerce_rich_text(),
                        }
                    },
                ),
            },
        )
    )

    # If parse failed (starts with ERROR|)
    actions.append(
        action(
            'is.workflow.actions.conditional',
            {
                'GroupingIdentifier': if_group,
                'WFControlFlowMode': 0,
                'WFCondition': 'Begins With',
                'WFConditionalActionString': 'ERROR|',
                'WFInput': token_attachment(parsed_uuid, 'Parsed'),
            },
        )
    )
    actions.append(
        action(
            'is.workflow.actions.replacetext',
            {
                'UUID': error_msg_uuid,
                'CustomOutputName': 'ErrorMessage',
                'WFReplaceTextFind': 'ERROR|',
                'WFReplaceTextReplace': '',
                'WFReplaceTextRegularExpression': False,
                'WFReplaceTextCaseSensitive': True,
                'WFInput': token_attachment(parsed_uuid, 'Parsed'),
            },
        )
    )
    actions.append(
        action(
            'is.workflow.actions.setclipboard',
            {
                'WFInput': token_attachment(error_msg_uuid, 'ErrorMessage'),
                'WFLocalOnly': False,
            },
        )
    )
    actions.append(
        action(
            'is.workflow.actions.exit',
            {},
        )
    )
    actions.append(
        action(
            'is.workflow.actions.conditional',
            {
                'UUID': uid(),
                'GroupingIdentifier': if_group,
                'WFControlFlowMode': 2,
            },
        )
    )

    # Split CODE|FILE|TITLE|CHAP|V1|V2|DISPLAY
    actions.append(
        action(
            'is.workflow.actions.text.split',
            {
                'UUID': split_uuid,
                'CustomOutputName': 'Parts',
                'WFTextSeparator': 'Custom',
                'WFTextCustomSeparator': '|',
                'text': token_attachment(parsed_uuid, 'Parsed'),
            },
        )
    )

    def nth(n: int, name: str, out_uuid: str) -> dict[str, Any]:
        return action(
            'is.workflow.actions.getitemfromlist',
            {
                'UUID': out_uuid,
                'CustomOutputName': name,
                'WFItemSpecifier': 'Item At Index',
                'WFItemIndex': str(n),
                'WFInput': token_attachment(split_uuid, 'Parts'),
            },
        )

    actions.append(nth(1, 'BookCode', code_uuid))
    actions.append(nth(2, 'BookFile', file_uuid))
    actions.append(nth(3, 'BookTitle', title_uuid))
    actions.append(nth(4, 'Chapter', chap_uuid))
    actions.append(nth(5, 'VerseStart', v1_uuid))
    actions.append(nth(6, 'VerseEnd', v2_uuid))
    actions.append(nth(7, 'DisplayRef', display_uuid))

    # Get File from {BibleRoot}/tex/{file}
    path_text = ORC + '/tex/' + ORC
    actions.append(
        action(
            'is.workflow.actions.documentpicker.open',
            {
                'UUID': getfile_uuid,
                'CustomOutputName': 'BookTeX',
                'SelectMultiple': False,
                'WFShowDocumentPicker': False,
                'WFFileErrorIfNotFound': True,
                'WFGetFilePath': token_string(
                    path_text,
                    {
                        '{0, 1}': {
                            'Type': 'Variable',
                            'VariableName': 'BibleRoot',
                        },
                        '{6, 1}': {
                            'OutputUUID': file_uuid,
                            'OutputName': 'BookFile',
                            'Type': 'ActionOutput',
                        },
                    },
                ),
            },
        )
    )

    # payload = CODE \t CHAP \t V1 \t V2 \t TEX
    payload_template = ORC + '\t' + ORC + '\t' + ORC + '\t' + ORC + '\t' + ORC
    # positions: 0=code, 2=chap, 4=v1, 6=v2, 8=tex  (each ORC is 1 char, tabs between)
    actions.append(
        action(
            'is.workflow.actions.gettext',
            {
                'UUID': payload_uuid,
                'CustomOutputName': 'ExtractPayload',
                'WFTextActionText': token_string(
                    payload_template,
                    {
                        '{0, 1}': {
                            'OutputUUID': code_uuid,
                            'OutputName': 'BookCode',
                            'Type': 'ActionOutput',
                        },
                        '{2, 1}': {
                            'OutputUUID': chap_uuid,
                            'OutputName': 'Chapter',
                            'Type': 'ActionOutput',
                        },
                        '{4, 1}': {
                            'OutputUUID': v1_uuid,
                            'OutputName': 'VerseStart',
                            'Type': 'ActionOutput',
                        },
                        '{6, 1}': {
                            'OutputUUID': v2_uuid,
                            'OutputName': 'VerseEnd',
                            'Type': 'ActionOutput',
                        },
                        '{8, 1}': {
                            'OutputUUID': getfile_uuid,
                            'OutputName': 'BookTeX',
                            'Type': 'ActionOutput',
                            'Aggrandizements': coerce_string(),
                        },
                    },
                ),
            },
        )
    )

    actions.append(
        action(
            'is.workflow.actions.urlencode',
            {
                'UUID': enc_payload_uuid,
                'CustomOutputName': 'EncodedPayload',
                'WFEncodeMode': 'Encode',
                'WFInput': token_string(
                    ORC,
                    {
                        '{0, 1}': {
                            'OutputUUID': payload_uuid,
                            'OutputName': 'ExtractPayload',
                            'Type': 'ActionOutput',
                        }
                    },
                ),
            },
        )
    )

    actions.append(
        action(
            'is.workflow.actions.gettext',
            {
                'UUID': extract_page_uuid,
                'CustomOutputName': 'ExtractPage',
                'WFTextActionText': data_uri_text(
                    'extract', enc_payload_uuid, 'EncodedPayload', js_b64
                ),
            },
        )
    )

    actions.append(
        action(
            'is.workflow.actions.setvariable',
            {
                'WFVariableName': 'ExtractPage',
                'WFInput': token_attachment(extract_page_uuid, 'ExtractPage'),
            },
        )
    )

    actions.append(
        action(
            'is.workflow.actions.url',
            {
                'UUID': extract_url_uuid,
                'CustomOutputName': 'ExtractURL',
                'Show-WFURLActionURL': True,
                'WFURLActionURL': token_string(
                    ORC,
                    {
                        '{0, 1}': {
                            'Type': 'Variable',
                            'VariableName': 'ExtractPage',
                        }
                    },
                ),
            },
        )
    )

    actions.append(
        action(
            'is.workflow.actions.urlencode',
            {
                'UUID': body_uuid,
                'CustomOutputName': 'VerseBody',
                'WFEncodeMode': 'Decode',
                'WFInput': token_string(
                    ORC,
                    {
                        '{0, 1}': {
                            'OutputUUID': extract_url_uuid,
                            'OutputName': 'ExtractURL',
                            'Type': 'ActionOutput',
                            'Aggrandizements': coerce_rich_text(),
                        }
                    },
                ),
            },
        )
    )

    # Final result: DisplayRef (Title)\n\nBody
    result_template = ORC + ' (' + ORC + ')\n\n' + ORC
    # positions: 0=display, 3=title (after " ("), then ")\n\n" = 4 chars, then body
    # "￼ (￼)\n\n￼" → indices 0, 3, 8
    actions.append(
        action(
            'is.workflow.actions.gettext',
            {
                'UUID': result_uuid,
                'CustomOutputName': 'Passage',
                'WFTextActionText': token_string(
                    result_template,
                    {
                        '{0, 1}': {
                            'OutputUUID': display_uuid,
                            'OutputName': 'DisplayRef',
                            'Type': 'ActionOutput',
                        },
                        '{3, 1}': {
                            'OutputUUID': title_uuid,
                            'OutputName': 'BookTitle',
                            'Type': 'ActionOutput',
                        },
                        '{8, 1}': {
                            'OutputUUID': body_uuid,
                            'OutputName': 'VerseBody',
                            'Type': 'ActionOutput',
                        },
                    },
                ),
            },
        )
    )

    actions.append(
        action(
            'is.workflow.actions.setclipboard',
            {
                'WFInput': token_attachment(result_uuid, 'Passage'),
                'WFLocalOnly': False,
            },
        )
    )

    workflow: dict[str, Any] = {
        'WFWorkflowActions': actions,
        'WFWorkflowClientVersion': '3036.0.4.2',
        'WFWorkflowHasOutputFallback': False,
        'WFWorkflowHasShortcutInputVariables': True,
        'WFWorkflowIcon': {
            'WFWorkflowIconGlyphNumber': 59494,  # book
            'WFWorkflowIconStartColor': 4282601983,
        },
        'WFWorkflowImportQuestions': [],
        'WFWorkflowInputContentItemClasses': [
            'WFStringContentItem',
            'WFAttributedTextContentItem',
        ],
        'WFWorkflowMinimumClientVersion': 900,
        'WFWorkflowMinimumClientVersionString': '900',
        'WFWorkflowName': 'Synodal Bible',
        'WFWorkflowOutputContentItemClasses': [
            'WFStringContentItem',
        ],
        'WFWorkflowTypes': [
            'ActionExtension',
            'Watch',
            'NCWidget',
        ],
    }

    OUT_PATH.write_bytes(plistlib.dumps(workflow, fmt=plistlib.FMT_XML))
    print(f'Wrote {OUT_PATH} ({OUT_PATH.stat().st_size} bytes)')
    print(f'Embedded JS: {len(js_source)} chars, abbr keys: {len(abbr_map)}')


if __name__ == '__main__':
    build()
