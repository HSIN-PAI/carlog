#!/usr/bin/env python3
"""產生兩個 iOS 捷徑(未簽章 plist),之後用 shortcuts sign --mode anyone 簽章:
  A「CarLog充電記帳」:LINE 充電扣款通知觸發 → 解析度數/金額 → 存成手機裡 CarLog/pending/<id>.json(不上網,停車場沒訊號也不會失敗)
  B「CarLog上傳」    :連上 Wi-Fi / 每天固定時間觸發 → 把 pending 裡的檔逐一 PUT 到 carlog-data/inbox/,成功才刪本機檔
參數鍵名依據:viticci/shortcuts-playground-plugin data/toolkit-v78-first-party-parameter-keys.json
注意:字串型參數(text、WFTextActionText、WFURL…)必須用 WFTextTokenString 內嵌變數,放 WFTextTokenAttachment 會被當未設定。
"""
import plistlib, uuid

REPO = 'HSIN-PAI/carlog-data'
PENDING_DIR = 'CarLog/pending'

def build(actions_fn, name, import_questions):
    actions = []
    def act(identifier, params, name=None):
        u = str(uuid.uuid4()).upper()
        p = {'UUID': u, **params}
        if name: p['CustomOutputName'] = name
        actions.append({'WFWorkflowActionIdentifier': identifier, 'WFWorkflowActionParameters': p})
        return u
    actions_fn(act)
    wf = {
        'WFWorkflowClientVersion': '2607.1.3',
        'WFWorkflowMinimumClientVersion': 900,
        'WFWorkflowMinimumClientVersionString': '900',
        'WFWorkflowIcon': {'WFWorkflowIconStartColor': 4282601983, 'WFWorkflowIconGlyphNumber': 59511},
        'WFWorkflowTypes': [],
        'WFWorkflowInputContentItemTypes': ['WFNotificationContentItem', 'WFStringContentItem', 'WFRichTextContentItem'],
        'WFWorkflowHasShortcutInputVariables': True,
        'WFWorkflowHasOutputFallback': False,
        'WFWorkflowImportQuestions': import_questions,
        'WFWorkflowActions': actions,
    }
    with open(f'{name}.unsigned.shortcut', 'wb') as f: plistlib.dump(wf, f)
    print(name, 'actions:', len(actions))

# ---- token helpers ----
def ref(u, name):
    return {'Value': {'OutputUUID': u, 'OutputName': name, 'Type': 'ActionOutput'}, 'WFSerializationType': 'WFTextTokenAttachment'}
def var(name):
    return {'Value': {'Type': 'Variable', 'VariableName': name}, 'WFSerializationType': 'WFTextTokenAttachment'}
def tok(*parts):
    """文字 token:parts 是 str、(uuid, name) 或 dict(attachment Value)。"""
    s, att = '', {}
    for p in parts:
        if isinstance(p, str): s += p
        else:
            att[f'{{{len(s)}, 1}}'] = p if isinstance(p, dict) else {'OutputUUID': p[0], 'OutputName': p[1], 'Type': 'ActionOutput'}
            s += '￼'
    return {'Value': {'string': s, 'attachmentsByRange': att}, 'WFSerializationType': 'WFTextTokenString'}
def dict_value(items):
    return {'Value': {'WFDictionaryFieldValueItems': [{'WFItemType': 0, 'WFKey': tok(k), 'WFValue': v if isinstance(v, dict) else tok(v)} for k, v in items]},
            'WFSerializationType': 'WFDictionaryFieldValue'}
INPUT_BODY = {'Type': 'ExtensionInput', 'Aggrandizements': [
    {'Type': 'WFCoercionVariableAggrandizement', 'CoercionItemClass': 'WFNotificationContentItem'},
    {'Type': 'WFPropertyVariableAggrandizement', 'PropertyName': 'Body'}]}
REPEAT_ITEM = {'Type': 'Variable', 'VariableName': 'Repeat Item'}

# ================= A:通知 → 存本機 =================
def shortcut_a(act):
    TEXT = act('is.workflow.actions.gettext', {'WFTextActionText': tok(INPUT_BODY)}, '通知文字')
    M_KWH = act('is.workflow.actions.text.match', {'WFMatchTextPattern': '([0-9.]+)度', 'WFMatchTextCaseSensitive': False, 'text': tok((TEXT, '通知文字'))}, '度數比對')
    G_KWH = act('is.workflow.actions.text.match.getgroup', {'WFGetGroupType': 'Group At Index', 'WFGroupIndex': 1, 'matches': ref(M_KWH, '度數比對')}, '各段度數')
    KWH = act('is.workflow.actions.statistics', {'WFStatisticsOperation': 'Sum', 'Input': ref(G_KWH, '各段度數')}, '度數')
    M_AMT = act('is.workflow.actions.text.match', {'WFMatchTextPattern': '=\\s*([0-9]+)\\s*元', 'WFMatchTextCaseSensitive': False, 'text': tok((TEXT, '通知文字'))}, '金額比對')
    G_AMT = act('is.workflow.actions.text.match.getgroup', {'WFGetGroupType': 'Group At Index', 'WFGroupIndex': 1, 'matches': ref(M_AMT, '金額比對')}, '各段金額')
    AMT = act('is.workflow.actions.statistics', {'WFStatisticsOperation': 'Sum', 'Input': ref(G_AMT, '各段金額')}, '金額')
    SEG = act('is.workflow.actions.count', {'WFCountType': 'Items', 'Input': ref(G_AMT, '各段金額')}, '段數')
    # 「總計: 49 元」那行;通知被截斷時抓不到 → App 會標記請人工確認
    M_TOT = act('is.workflow.actions.text.match', {'WFMatchTextPattern': '總計[:：]\\s*([0-9]+)', 'WFMatchTextCaseSensitive': False, 'text': tok((TEXT, '通知文字'))}, '總計比對')
    G_TOT = act('is.workflow.actions.text.match.getgroup', {'WFGetGroupType': 'Group At Index', 'WFGroupIndex': 1, 'matches': ref(M_TOT, '總計比對')}, '總計')
    ID = act('is.workflow.actions.number.random', {'WFRandomNumberMinimum': 100000000, 'WFRandomNumberMaximum': 999999999}, '編號')
    ITEM = act('is.workflow.actions.dictionary', {'WFItems': dict_value([
        ('amount', tok((AMT, '金額'))), ('kwh', tok((KWH, '度數'))), ('category', 'charging'),
        ('note', '社區充電樁 自動記帳'), ('id', tok((ID, '編號'))),
        ('total', tok((G_TOT, '總計'))), ('segments', tok((SEG, '段數'))),
    ])}, '支出')
    JSON_TXT = act('is.workflow.actions.gettext', {'WFTextActionText': tok((ITEM, '支出'))}, '支出 JSON')
    act('is.workflow.actions.documentpicker.save', {
        'WFInput': ref(JSON_TXT, '支出 JSON'), 'WFAskWhereToSave': False, 'WFSaveFileOverwrite': True,
        'WFFileDestinationPath': tok(f'{PENDING_DIR}/', (ID, '編號'), '.json'),
    }, '暫存檔')
    act('is.workflow.actions.notification', {'WFNotificationActionTitle': 'CarLog 已暫存', 'WFNotificationActionBody': tok('分段合計 ', (AMT, '金額'), ' 元(', (SEG, '段數'), ' 段,總計行:', (G_TOT, '總計'), '),', (KWH, '度數'), ' 度;連上網路後自動上傳'), 'WFNotificationActionSound': False})

# ================= B:上傳 pending =================
def shortcut_b(act):
    TOKEN = act('is.workflow.actions.gettext', {'WFTextActionText': '請在這裡貼上 GitHub token'}, 'GitHub token')
    FILES = act('is.workflow.actions.documentpicker.open', {'WFGetFilePath': PENDING_DIR, 'WFGetFolderContents': True, 'WFFileErrorIfNotFound': False}, '待傳檔案')
    grp = str(uuid.uuid4()).upper()
    act('is.workflow.actions.repeat.each', {'WFControlFlowMode': 0, 'GroupingIdentifier': grp, 'WFInput': ref(FILES, '待傳檔案')})
    RND = act('is.workflow.actions.number.random', {'WFRandomNumberMinimum': 100000000, 'WFRandomNumberMaximum': 999999999}, '雲端檔名')
    B64 = act('is.workflow.actions.base64encode', {'WFEncodeMode': 'Encode', 'WFBase64LineBreakMode': 'None', 'WFInput': var('Repeat Item')}, 'base64')
    act('is.workflow.actions.downloadurl', {
        'WFURL': tok(f'https://api.github.com/repos/{REPO}/contents/inbox/', (RND, '雲端檔名'), '.json'),
        'WFHTTPMethod': 'PUT',
        'WFHTTPHeaders': dict_value([('Authorization', tok('Bearer ', (TOKEN, 'GitHub token'))), ('Accept', 'application/vnd.github+json'), ('X-GitHub-Api-Version', '2022-11-28')]),
        'WFHTTPBodyType': 'JSON',
        'WFJSONValues': dict_value([('message', 'CarLog inbox 自動記帳'), ('content', tok((B64, 'base64'))), ('branch', 'main')]),
        'ShowHeaders': True,
    }, 'GitHub 回應')
    act('is.workflow.actions.file.delete', {'WFInput': var('Repeat Item'), 'WFDeleteImmediatelyDelete': True})
    act('is.workflow.actions.notification', {'WFNotificationActionTitle': 'CarLog 已上傳', 'WFNotificationActionBody': '一筆充電紀錄已送到雲端,開 App 會同步進來', 'WFNotificationActionSound': False})
    act('is.workflow.actions.repeat.each', {'WFControlFlowMode': 2, 'GroupingIdentifier': grp})

build(shortcut_a, 'CarLog充電記帳', [])
build(shortcut_b, 'CarLog上傳', [{'ActionIndex': 0, 'Category': 'Parameter', 'ParameterKey': 'WFTextActionText',
                                  'Text': '貼上你的 GitHub token(CarLog App → 設定 → 雲端同步 → 複製 token)', 'DefaultValue': ''}])
