#!/usr/bin/env python3
"""產生「CarLog 充電記帳」iOS 捷徑(未簽章的 .shortcut plist)。
用法:python3 build_shortcut.py && shortcuts sign --mode anyone -i CarLog充電記帳.unsigned.shortcut -o CarLog充電記帳.shortcut
流程:捷徑輸入(LINE 通知)→ 抓度數加總、抓總計金額 → 組 JSON → base64 → PUT 到 carlog-data/inbox/<時間>.json
"""
import plistlib, uuid

REPO = 'HSIN-PAI/carlog-data'
actions = []
def act(identifier, params, name=None):
    u = str(uuid.uuid4()).upper()
    p = {'UUID': u, **params}
    if name: p['CustomOutputName'] = name
    actions.append({'WFWorkflowActionIdentifier': identifier, 'WFWorkflowActionParameters': p})
    return u

def ref(u, name):  # 引用某動作的輸出
    return {'Value': {'OutputUUID': u, 'OutputName': name, 'Type': 'ActionOutput'}, 'WFSerializationType': 'WFTextTokenAttachment'}
def shortcut_input():
    return {'Value': {'Type': 'ExtensionInput'}, 'WFSerializationType': 'WFTextTokenAttachment'}
def current_date():
    return {'Value': {'Type': 'CurrentDate'}, 'WFSerializationType': 'WFTextTokenAttachment'}
def tok(*parts):
    """文字 token:parts 是 str 或 (uuid, name) 的混合。"""
    s, att = '', {}
    for p in parts:
        if isinstance(p, str): s += p
        else:
            att[f'{{{len(s)}, 1}}'] = {'OutputUUID': p[0], 'OutputName': p[1], 'Type': 'ActionOutput'}
            s += '￼'
    return {'Value': {'string': s, 'attachmentsByRange': att}, 'WFSerializationType': 'WFTextTokenString'}
def dict_value(items):
    return {'Value': {'WFDictionaryFieldValueItems': [{'WFItemType': 0, 'WFKey': tok(k), 'WFValue': v if isinstance(v, dict) else tok(v)} for k, v in items]},
            'WFSerializationType': 'WFDictionaryFieldValue'}

# 0 token(匯入時會問)
TOKEN = act('is.workflow.actions.gettext', {'WFTextActionText': '把這行換成你的 GitHub token'}, 'GitHub token')
# 1 通知 → 文字
TEXT = act('is.workflow.actions.detect.text', {'WFInput': shortcut_input()}, '通知文字')
# 2-4 度數
M_KWH = act('is.workflow.actions.text.match', {'WFMatchTextPattern': '([0-9.]+)度', 'WFMatchTextCaseSensitive': False, 'text': ref(TEXT, '通知文字')}, '度數比對')
G_KWH = act('is.workflow.actions.text.match.getgroup', {'WFGetGroupType': 'Group At Index', 'WFGroupIndex': 1, 'matches': ref(M_KWH, '度數比對')}, '各段度數')
KWH = act('is.workflow.actions.statistics', {'WFStatisticsOperation': 'Sum', 'Input': ref(G_KWH, '各段度數')}, '度數')
# 5-7 金額:每段「= N 元」加總(等於總計;不依賴「總計」那行的冒號全半形,通知被截斷也能部分計算)
M_AMT = act('is.workflow.actions.text.match', {'WFMatchTextPattern': '=\\s*([0-9]+)\\s*元', 'WFMatchTextCaseSensitive': False, 'text': ref(TEXT, '通知文字')}, '金額比對')
G_AMT = act('is.workflow.actions.text.match.getgroup', {'WFGetGroupType': 'Group At Index', 'WFGroupIndex': 1, 'matches': ref(M_AMT, '金額比對')}, '各段金額')
AMT = act('is.workflow.actions.statistics', {'WFStatisticsOperation': 'Sum', 'Input': ref(G_AMT, '各段金額')}, '金額')
# 8 檔名:亂數(「格式化日期」在產生的捷徑裡沒有輸出,改不依賴它;日期由 App 以提交時間判定)
FNAME = act('is.workflow.actions.number.random', {'WFRandomNumberMinimum': 100000000, 'WFRandomNumberMaximum': 999999999}, '檔名')
# 10 支出 JSON
ITEM = act('is.workflow.actions.dictionary', {'WFItems': dict_value([
    ('amount', tok((AMT, '金額'))), ('kwh', tok((KWH, '度數'))), ('category', 'charging'),
    ('note', '社區充電樁 自動記帳'),
])}, '支出')
ITEM_TXT = act('is.workflow.actions.gettext', {'WFTextActionText': tok((ITEM, '支出'))}, '支出 JSON')
B64 = act('is.workflow.actions.base64encode', {'WFEncodeMode': 'Encode', 'WFBase64LineBreakMode': 'None', 'WFInput': ref(ITEM_TXT, '支出 JSON')}, 'base64')
# 11 PUT 到 GitHub
PUT = act('is.workflow.actions.downloadurl', {
    'WFURL': tok(f'https://api.github.com/repos/{REPO}/contents/inbox/', (FNAME, '檔名'), '.json'),
    'WFHTTPMethod': 'PUT',
    'WFHTTPHeaders': dict_value([('Authorization', tok('Bearer ', (TOKEN, 'GitHub token'))), ('Accept', 'application/vnd.github+json'), ('X-GitHub-Api-Version', '2022-11-28')]),
    'WFHTTPBodyType': 'JSON',
    'WFJSONValues': dict_value([('message', 'CarLog inbox 自動記帳'), ('content', tok((B64, 'base64'))), ('branch', 'main')]),
    'ShowHeaders': True,
}, 'GitHub 回應')
# 12 通知自己
act('is.workflow.actions.notification', {'WFNotificationActionTitle': 'CarLog 已記帳', 'WFNotificationActionBody': tok('充電 ', (AMT, '金額'), ' 元,', (KWH, '度數'), ' 度,開 App 會同步進來'), 'WFNotificationActionSound': False})

wf = {
    'WFWorkflowClientVersion': '2607.1.3',
    'WFWorkflowMinimumClientVersion': 900,
    'WFWorkflowMinimumClientVersionString': '900',
    'WFWorkflowIcon': {'WFWorkflowIconStartColor': 4282601983, 'WFWorkflowIconGlyphNumber': 59511},
    'WFWorkflowTypes': [],
    'WFWorkflowInputContentItemTypes': ['WFStringContentItem', 'WFRichTextContentItem', 'WFURLContentItem', 'WFGenericFileContentItem'],
    'WFWorkflowHasShortcutInputVariables': True,
    'WFWorkflowHasOutputFallback': False,
    'WFWorkflowImportQuestions': [],
    'WFWorkflowActions': actions,
}
with open('CarLog充電記帳.unsigned.shortcut', 'wb') as f: plistlib.dump(wf, f)
print('actions:', len(actions))
