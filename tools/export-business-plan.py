#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 BUSINESS-PLAN.html 导出为 PDF 与 Word(.docx) 两份文档。

用法：
    python3 tools/export-business-plan.py            # 同时导出 PDF + DOCX
    python3 tools/export-business-plan.py --only pdf
    python3 tools/export-business-plan.py --only docx

依赖：weasyprint（PDF）、python-docx（DOCX）、beautifulsoup4（解析）
设计原则：HTML 是唯一事实源，本脚本只读不改；所有排版细节在此集中，
         保证两份产物与网页版口径完全一致。
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

from bs4 import BeautifulSoup, NavigableString

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "BUSINESS-PLAN.html"
OUT_DIR = ROOT

DOC_TITLE = "《占地之王》商业计划书"
WATERMARK = "《占地之王》商业计划书 · Confidential"

# ---------------------------------------------------------------- 调色板
# 与 BUSINESS-PLAN.html 内联 CSS 保持一致
C_NAVY = "12263F"
C_BLUE = "1E3A5F"
C_RED = "C0392B"
C_GREEN = "15803D"
C_AMBER = "B45309"
C_GRAY = "64748B"
C_TEXT = "1F2937"
C_HEAD_BG = "1E3A5F"
C_ROW_ALT = "F8FAFC"

BOX_STYLE = {
    "callout": (C_AMBER, "FFF7ED", "提示"),
    "good-box": (C_GREEN, "F0FDF4", "优势"),
    "risk-box": (C_RED, "FEF2F2", "风险"),
}

TAG_STYLE = {
    "t-green": C_GREEN,
    "t-amber": C_AMBER,
    "t-red": C_RED,
    "t-blue": "1D4ED8",
}


# ==================================================================
# 一、PDF（WeasyPrint 直排 HTML，保留卡片/表格/提示框的完整排版）
# ==================================================================

# 注入到 </style> 之前的打印专用 CSS：
#   1. 把系统里没有的 PingFang / 微软雅黑 换成沙箱已有的 Noto Sans CJK SC
#   2. flex 布局降级为 table 布局（WeasyPrint 对 flex 支持不完整）
#   3. A4 页面尺寸 + 页脚页码
PRINT_CSS = f"""
@page {{
  size: A4;
  margin: 16mm 15mm 17mm;
  @bottom-center {{
    content: "{WATERMARK} · 第 " counter(page) " / " counter(pages) " 页";
    font-family: "Noto Sans CJK SC", sans-serif;
    font-size: 8.5pt; color: #8a94a6;
  }}
}}
@page :first {{
  @bottom-center {{ content: "{WATERMARK}"; }}
}}
html, body, div, p, li, td, th, span, h1, h2, h3, h4, b, strong, em, a, ol, ul {{
  font-family: "Noto Sans CJK SC", "Noto Sans", sans-serif !important;
}}
.formula, .formula * {{
  font-family: "Noto Sans Mono CJK SC", "Noto Sans Mono", monospace !important;
}}
body {{ background: #fff; font-size: 10.2pt; line-height: 1.72; }}
.wrap {{ box-shadow: none; max-width: 100%; }}
.cover {{ padding: 36mm 12mm 14mm; }}
.cover h1 {{ font-size: 30pt; }}
.cover .sub {{ font-size: 13pt; }}
.kpis, .kv {{
  display: table !important; table-layout: fixed;
  width: 100%; border-spacing: 2.6mm;
  margin-left: -2.6mm; margin-right: -2.6mm;
}}
.kpi, .kv > div {{
  display: table-cell !important;
  min-width: 0 !important; flex: none !important;
  vertical-align: top; padding: 3mm 3.5mm;
}}
.body {{ padding: 0; }}
h2 {{ page-break-after: avoid; break-after: avoid; font-size: 15pt; margin: 10mm 0 3.5mm; }}
h3 {{ page-break-after: avoid; break-after: avoid; font-size: 12pt; margin: 6mm 0 2mm; }}
h4 {{ page-break-after: avoid; break-after: avoid; }}
table {{ page-break-inside: avoid; font-size: 9pt; width: 100%; }}
th {{ padding: 2.2mm 2.6mm; font-size: 9pt; }}
td {{ padding: 1.9mm 2.6mm; }}
.kpi, .kv, .kv > div, .callout, .good-box, .risk-box, .formula {{
  page-break-inside: avoid; break-inside: avoid;
}}
.toc {{ page-break-inside: avoid; }}
"""


def make_pdf(out: Path) -> None:
    from weasyprint import HTML

    html = SRC.read_text(encoding="utf-8")
    html = html.replace("</style>", PRINT_CSS + "\n</style>")
    HTML(string=html, base_url=str(SRC.parent)).write_pdf(str(out))


# ==================================================================
# 二、Word（python-docx 重建：标题层级 + 真实表格 + 提示框体样式）
# ==================================================================

def make_docx(out: Path) -> None:
    from docx import Document
    from docx.enum.section import WD_SECTION
    from docx.enum.table import WD_TABLE_ALIGNMENT
    from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.shared import Cm, Pt, RGBColor

    def sub(parent, tag, **attrs):
        el = OxmlElement(tag)
        for k, v in attrs.items():
            el.set(qn(f"w:{k}"), v)
        parent.append(el)
        return el

    def rgb(hex_str: str) -> RGBColor:
        return RGBColor.from_string(hex_str)

    # ---------- 运行级字体 ----------
    def style_run(run, size=10.5, bold=None, italic=None, color=C_TEXT, mono=False):
        f = run.font
        f.size = Pt(size)
        f.name = "Consolas" if mono else "Segoe UI"
        if bold is not None:
            f.bold = bold
        if italic is not None:
            f.italic = italic
        if color is not None:
            f.color.rgb = rgb(color)
        rPr = run._element.get_or_add_rPr()
        rFonts = rPr.find(qn("w:rFonts"))
        if rFonts is None:
            rFonts = sub(rPr, "w:rFonts")
        rFonts.set(qn("w:ascii"), "Consolas" if mono else "Segoe UI")
        rFonts.set(qn("w:hAnsi"), "Consolas" if mono else "Segoe UI")
        # 中文 fall back：Word 按脚本自动选用 eastAsia 字体
        rFonts.set(qn("w:eastAsia"), "Consolas" if mono else "微软雅黑")
        return run

    # ---------- 段落级装饰 ----------
    def shade(target, fill_hex: str):
        """target: paragraph 或 table cell"""
        from docx.oxml.ns import qn as _qn
        tag_base = target._tc if hasattr(target, "_tc") else target._p
        pr = tag_base.get_or_add_tcPr() if hasattr(target, "_tc") else tag_base.get_or_add_pPr()
        sub(pr, "w:shd", val="clear", color="auto", fill=fill_hex)

    def para_border(para, left=None, bottom=None, space=6):
        pPr = para._p.get_or_add_pPr()
        pBdr = OxmlElement("w:pBdr")
        specs = [("left", left), ("bottom", bottom)]
        for side, spec in specs:
            if not spec:
                continue
            color, sz = spec
            el = sub(pBdr, f"w:{side}", val="single", sz=str(sz),
                     space=str(space), color=color)
        if len(pBdr):
            pPr.append(pBdr)

    def repeat_header(row):
        trPr = row._tr.get_or_add_trPr()
        trPr.append(OxmlElement("w:tblHeader"))

    def no_split_row(row):
        trPr = row._tr.get_or_add_trPr()
        trPr.append(OxmlElement("w:cantSplit"))

    # ---------- 行内内容递归渲染 ----------
    def emit_inline(node, para, *, size=10.5, color=C_TEXT, mono=False, bold=False):
        """把 node 的子节点按行内语义写进 para（保留加粗/斜体/着色/换行）"""
        for child in node.children:
            if isinstance(child, NavigableString):
                text = str(child)
                if text.strip() == "" and "\n" in text:
                    continue
                style_run(para.add_run(re.sub(r"\s+", " ", text) if "\n" in text else text),
                          size=size, bold=bold, color=color, mono=mono)
                continue
            if child.name is None:
                continue
            cls = child.get("class") or []
            _bold = bold or child.name in ("strong", "b")
            _italic = child.name in ("em", "i")
            _mono = mono or child.name == "code"
            if child.name == "br":
                para.add_run().add_break()
                continue
            if "tag" in cls:
                tone = next((TAG_STYLE[c] for c in cls if c in TAG_STYLE), C_BLUE)
                label = child.get_text(strip=True)
                style_run(para.add_run(f"[{label}]"), size=size - 1.5,
                          bold=True, color=tone)
                style_run(para.add_run(" "), size=size, color=color)
                continue
            _color = color
            if "up" in cls:
                _color = C_RED
                _bold = True
            elif "down" in cls:
                _color = C_GREEN
                _bold = True
            elif "hl" in cls:
                _color = "FBBF24"
                _bold = True
            elif "no" in cls:
                _color = C_RED
                _bold = True
            emit_inline(child, para, size=size, color=_color, mono=_mono, bold=_bold)
        return para

    def new_para(size=10.5, color=C_TEXT, align=None, before=0, after=6,
                 indent=None, mono=False, line=1.5):
        p = doc.add_paragraph()
        pf = p.paragraph_format
        pf.space_before = Pt(before)
        pf.space_after = Pt(after)
        pf.line_spacing = line
        if align is not None:
            p.alignment = align
        if indent is not None:
            pf.left_indent = Cm(indent)
        return p

    def rich_block(el, *, size=10.5, color=C_TEXT, after=6, indent=None, mono=False):
        p = new_para(size=size, color=color, after=after, indent=indent, mono=mono)
        emit_inline(el, p, size=size, color=color, mono=mono)
        return p

    # ---------- 文档骨架 ----------
    doc = Document()

    # 核心属性
    cp = doc.core_properties
    cp.title = DOC_TITLE
    cp.subject = "基于成熟技术资产的微信小游戏商业化方案"
    cp.author = "占地之王项目组"
    cp.category = "商业计划书"
    cp.comments = "由 BUSINESS-PLAN.html 自动导出"

    # 页面设置
    sec = doc.sections[0]
    sec.page_width = Cm(21.0)
    sec.page_height = Cm(29.7)
    sec.left_margin = Cm(2.2)
    sec.right_margin = Cm(2.2)
    sec.top_margin = Cm(2.2)
    sec.bottom_margin = Cm(2.0)
    CONTENT_W = Cm(21.0 - 2.2 - 2.2)  # 16.6cm

    # Normal 样式：中文走微软雅黑
    normal = doc.styles["Normal"]
    normal.font.size = Pt(10.5)
    normal.font.name = "Segoe UI"
    normal.element.rPr.rFonts.set(qn("w:eastAsia"), "微软雅黑")
    normal.paragraph_format.space_after = Pt(6)
    normal.paragraph_format.line_spacing = 1.5

    # 页脚：居中页码
    footer_p = sec.footer.paragraphs[0]
    footer_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = style_run(footer_p.add_run("— "), size=8.5, color=C_GRAY)
    fld = OxmlElement("w:fldSimple")
    fld.set(qn("w:instr"), "PAGE")
    footer_p._p.append(fld)
    style_run(footer_p.add_run(" —"), size=8.5, color=C_GRAY)

    # ---------- 解析 ----------
    soup = BeautifulSoup(SRC.read_text(encoding="utf-8"), "html.parser")
    cover = soup.select_one(".cover")
    kpis = soup.select_one(".kpis")
    toc = soup.select_one(".toc")
    body = soup.select_one(".body")

    # ---------- 封面 ----------
    new_para(after=0).add_run()
    new_para(after=0).add_run()
    new_para(after=0).add_run()

    p = new_para(after=4)
    for ch in (cover.select_one(".eyebrow").get_text(strip=True) or ""):
        style_run(p.add_run(ch), size=10, bold=True, color=C_GRAY)

    p = new_para(after=2)
    style_run(p.add_run(cover.select_one("h1").get_text(strip=True)),
              size=28, bold=True, color=C_NAVY)

    p = new_para(after=10)
    style_run(p.add_run(cover.select_one(".sub").get_text(strip=True)),
              size=13, color=C_BLUE)

    p = new_para(after=16, before=6)
    para_border(p, bottom=(C_NAVY, 8), space=1)
    style_run(p.add_run(cover.select_one(".meta").get_text(" ", strip=True)),
              size=9.5, color=C_GRAY)

    # 封面 KPI 表
    add_table = None

    def add_kpi_table(container, ncols=2):
        cards = container.select(".kpi")
        rows = (len(cards) + ncols - 1) // ncols
        t = doc.add_table(rows=rows, cols=ncols)
        t.alignment = WD_TABLE_ALIGNMENT.CENTER
        t.autofit = False
        for row in t.rows:
            for cell in row.cells:
                cell.width = CONTENT_W / ncols
        for idx, card in enumerate(cards):
            cell = t.rows[idx // ncols].cells[idx % ncols]
            shade(cell, "EEF2F7")
            for box in cell.paragraphs:
                for run in box.runs:
                    run.text = ""
                break
            cell.paragraphs[0].text = ""
            p = cell.paragraphs[0]
            p.paragraph_format.space_after = Pt(2)
            p.paragraph_format.space_before = Pt(2)
            style_run(p.add_run(card.select_one(".n").get_text(" ", strip=True)),
                      size=16, bold=True, color=C_RED)
            p2 = cell.add_paragraph()
            p2.paragraph_format.space_after = Pt(2)
            style_run(p2.add_run(card.select_one(".l").get_text(" ", strip=True)),
                      size=9, color=C_GRAY)
        return t

    add_kpi_table(kpis)
    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)

    # ---------- 目录 ----------
    p = new_para(after=8)
    style_run(p.add_run("目录"), size=15, bold=True, color=C_NAVY)
    for li in toc.select("ol > li"):
        p = new_para(after=2, indent=0.4)
        # 与正文 h2 序号对齐
        idx = toc.select("ol > li").index(li) + 1
        style_run(p.add_run(f"{idx:02d}  "), size=10.5, bold=True, color=C_RED)
        style_run(p.add_run(li.get_text(strip=True)), size=10.5, color=C_TEXT)
    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)

    # ---------- 通用表格渲染 ----------
    def add_html_table(tbl):
        head_tr = tbl.select_one("thead tr")
        body_trs = [tr for tr in tbl.select("tbody tr")] or [
            tr for tr in tbl.select("tr") if tr is not head_tr
        ]
        ncols = len(head_tr.select("th, td")) if head_tr else len(body_trs[0].select("th, td"))
        nrows = len(body_trs) + (1 if head_tr else 0)
        t = doc.add_table(rows=nrows, cols=ncols)
        t.style = "Table Grid"
        t.alignment = WD_TABLE_ALIGNMENT.CENTER
        t.autofit = False
        col_w = CONTENT_W / ncols
        for row in t.rows:
            no_split_row(row)
            for cell in row.cells:
                cell.width = col_w
        fsz = 9.0 if ncols <= 5 else 8.5

        r_i = 0
        if head_tr:
            repeat_header(t.rows[0])
            for ci, th in enumerate(head_tr.select("th, td")):
                cell = t.rows[0].cells[ci]
                shade(cell, C_HEAD_BG)
                p = cell.paragraphs[0]
                p.paragraph_format.space_after = Pt(1)
                p.paragraph_format.space_before = Pt(1)
                p.paragraph_format.line_spacing = 1.15
                emit_inline(th, p, size=fsz, bold=True, color="FFFFFF")
            r_i = 1
        for bi, tr in enumerate(body_trs):
            row = t.rows[r_i + bi]
            if bi % 2 == 1:
                for cell in row.cells:
                    shade(cell, C_ROW_ALT)
            cells = tr.select("th, td")
            for ci, td in enumerate(cells[:ncols]):
                cell = row.cells[ci]
                p = cell.paragraphs[0]
                p.paragraph_format.space_after = Pt(1)
                p.paragraph_format.space_before = Pt(1)
                p.paragraph_format.line_spacing = 1.2
                emit_inline(td, p, size=fsz)
        doc.add_paragraph().paragraph_format.space_after = Pt(4)
        return t

    # ---------- 提示框 ----------
    def add_box(el, kind):
        bar_color, fill, _label = BOX_STYLE[kind]
        p = new_para(size=10, after=8, before=6)
        p.paragraph_format.left_indent = Cm(0.25)
        p.paragraph_format.right_indent = Cm(0.15)
        shade(p, fill)
        para_border(p, left=(bar_color, 18), space=8)
        emit_inline(el, p, size=10)
        return p

    # ---------- 键值卡片 ----------
    def add_kv(el):
        items = el.select(":scope > div")
        t = doc.add_table(rows=len(items), cols=2)
        t.style = "Table Grid"
        t.autofit = False
        for row in t.rows:
            no_split_row(row)
            row.cells[0].width = CONTENT_W * 0.42
            row.cells[1].width = CONTENT_W * 0.58
        for i, item in enumerate(items):
            kt, kv_ = item.select_one(".t"), item.select_one(".v")
            if kt is None or kv_ is None:
                continue
            c0, c1 = t.rows[i].cells
            shade(c0, "F8FAFC")
            p = c0.paragraphs[0]
            p.paragraph_format.space_after = Pt(1)
            p.paragraph_format.line_spacing = 1.2
            emit_inline(kt, p, size=9, color=C_GRAY)
            p = c1.paragraphs[0]
            p.paragraph_format.space_after = Pt(1)
            p.paragraph_format.line_spacing = 1.2
            emit_inline(kv_, p, size=11.5, bold=True, color=C_BLUE)
        doc.add_paragraph().paragraph_format.space_after = Pt(4)
        return t

    # ---------- 公式/代码块 ----------
    def add_formula(el):
        p = new_para(size=9.5, after=8, before=6)
        p.paragraph_format.left_indent = Cm(0.2)
        shade(p, "0F172A")
        emit_inline(el, p, size=9.5, color="E2E8F0", mono=True)
        return p

    # ---------- 主体块级遍历 ----------
    def render(node, list_level=0, ordered=False):
        for child in node.children:
            if isinstance(child, NavigableString):
                continue
            if child.name is None:
                continue
            name = child.name
            cls = child.get("class") or []

            if name == "h2":
                no = child.select_one(".no")
                label = no.get_text(strip=True) if no else ""
                if no:
                    no.extract()
                p = new_para(before=16, after=6)
                para_border(p, bottom=(C_NAVY, 12), space=3)
                if label:
                    style_run(p.add_run(f"{label}  "), size=16, bold=True, color=C_RED)
                style_run(p.add_run(child.get_text(strip=True)), size=16, bold=True, color=C_NAVY)
                p.paragraph_format.keep_with_next = True
            elif name == "h3":
                p = new_para(before=12, after=4)
                style_run(p.add_run(child.get_text(strip=True)), size=13, bold=True, color=C_BLUE)
                p.paragraph_format.keep_with_next = True
            elif name == "h4":
                p = new_para(before=8, after=3)
                style_run(p.add_run(child.get_text(strip=True)), size=11.5, bold=True, color="334155")
                p.paragraph_format.keep_with_next = True
            elif name == "p":
                if "footnote" in cls:
                    p = rich_block(child, size=9, color=C_GRAY, after=8)
                    para_border(p, bottom=("E5E9EF", 4), space=2)
                else:
                    rich_block(child, after=6)
            elif name == "table":
                add_html_table(child)
            elif name in ("ul", "ol"):
                render(child, list_level + 1, ordered=(name == "ol"))
            elif name == "li":
                p = new_para(after=3, indent=0.75 + list_level * 0.5)
                if ordered and child.parent.name == "ol":
                    pass
                marker = "· " if not ordered else ""
                style_run(p.add_run(marker), size=10.5, bold=True, color=C_BLUE)
                emit_inline(child, p, size=10.5)
            elif name == "div":
                if "callout" in cls:
                    add_box(child, "callout")
                elif "good-box" in cls:
                    add_box(child, "good-box")
                elif "risk-box" in cls:
                    add_box(child, "risk-box")
                elif "kv" in cls:
                    add_kv(child)
                elif "formula" in cls:
                    add_formula(child)
                elif "toc" in cls:
                    continue
                else:
                    # 无语义容器：当作段落处理（有行内标签时）或继续下钻
                    text = child.get_text(strip=True)
                    if text:
                        rich_block(child, after=5)
            else:
                text = child.get_text(strip=True)
                if text:
                    rich_block(child, after=5)

    render(body)
    doc.save(str(out))


# ==================================================================
def main():
    ap = argparse.ArgumentParser(description="导出《占地之王》商业计划书 PDF / DOCX")
    ap.add_argument("--only", choices=["pdf", "docx"], help="只导出指定格式")
    args = ap.parse_args()

    if not SRC.exists():
        sys.exit(f"源文件不存在：{SRC}")

    jobs = []
    if args.only in (None, "pdf"):
        jobs.append(("pdf", OUT_DIR / "BUSINESS-PLAN.pdf", make_pdf))
    if args.only in (None, "docx"):
        jobs.append(("docx", OUT_DIR / "BUSINESS-PLAN.docx", make_docx))

    for kind, path, fn in jobs:
        try:
            fn(path)
        except Exception as e:  # noqa: BLE001
            print(f"[FAIL] {kind}: {type(e).__name__}: {e}", file=sys.stderr)
            continue
        print(f"[OK] {kind:<5} -> {path.name}  ({path.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
