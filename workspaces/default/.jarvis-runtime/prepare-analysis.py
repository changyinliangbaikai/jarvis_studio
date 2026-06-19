import json, os
DATA = json.loads(r'''{"path":"input/customer_list.xlsx","sheetNames":["客户清单"],"sheets":[{"name":"客户清单","rows":6,"columns":6,"headers":["客户编号","客户姓名","资产","近30日交易","手机号","客户等级"],"missingValues":{"客户编号":0,"客户姓名":0,"资产":0,"近30日交易":0,"手机号":2,"客户等级":0},"numericSummary":{"资产":{"count":6,"min":-5000,"max":4200000,"avg":931666.67},"近30日交易":{"count":6,"min":0,"max":46,"avg":12.5}},"sample":[{"客户编号":"C001","客户姓名":"张三","资产":120000,"近30日交易":18,"手机号":"13800000001","客户等级":"A"},{"客户编号":"C002","客户姓名":"李四","资产":980000,"近30日交易":2,"手机号":"","客户等级":"S"},{"客户编号":"C003","客户姓名":"王五","资产":35000,"近30日交易":0,"手机号":"13800000003","客户等级":"C"},{"客户编号":"C004","客户姓名":"赵六","资产":4200000,"近30日交易":46,"手机号":"13800000004","客户等级":"S"},{"客户编号":"C005","客户姓名":"钱七","资产":-5000,"近30日交易":1,"手机号":"13800000005","客户等级":"B"},{"客户编号":"C006","客户姓名":"孙八","资产":260000,"近30日交易":8,"手机号":null,"客户等级":"A"}]}]}''')
os.makedirs('output', exist_ok=True)
sheets = DATA.get('sheets', [])
lines = ['# Excel 数据分析报告', '', '## 数据概况']
for sheet in sheets:
    lines.append(f"- {sheet.get('name')}: {sheet.get('rows')} 行，{sheet.get('columns')} 列")
    lines.append(f"- 字段: {', '.join(sheet.get('headers', []))}")
lines += ['', '## 关键发现']
for sheet in sheets:
    for field, stats in sheet.get('numericSummary', {}).items():
        lines.append(f"- {field}: 最小值 {stats.get('min')}，最大值 {stats.get('max')}，平均值 {stats.get('avg')}")
lines += ['', '## 异常点 / 异常发现']
for sheet in sheets:
    missing = sheet.get('missingValues', {})
    bad = [f"{k} 缺失 {v}" for k, v in missing.items() if v]
    lines.append(f"- {sheet.get('name')}: " + ("；".join(bad) if bad else "未发现缺失值"))
lines += ['', '## 建议', '- 优先核验异常值和高价值客户记录。', '- 按指标区间分层触达，并跟踪转化结果。', '', '## 方法说明', '- 本报告基于 xlsx.inspect 的真实工作簿结构和统计结果生成。']
with open('output/analysis_report.md', 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))
print(json.dumps({'report': 'output/analysis_report.md', 'sheets': len(sheets)}, ensure_ascii=False))
