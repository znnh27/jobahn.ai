import Link from "next/link";

const NEUTRAL_SWATCHES = [
  ["50", "#fafafa"],
  ["100", "#f5f5f5"],
  ["200", "#e5e5e5"],
  ["300", "#d4d4d4"],
  ["400", "#a3a3a3"],
  ["500", "#737373"],
  ["600", "#525252"],
  ["700", "#404040"],
  ["800", "#262626"],
  ["900", "#171717"],
] as const;

const SEMANTIC_SWATCHES = [
  ["--color-danger-bg", "#fef2f2"],
  ["--color-danger-text", "#b91c1c"],
  ["--color-danger-text-strong", "#dc2626"],
  ["--color-success-bg", "#f0fdf4"],
  ["--color-success-text", "#15803d"],
  ["--color-warning-bg", "#fffbeb"],
  ["--color-warning-text", "#92400e"],
  ["--color-info-bg", "#eff6ff"],
  ["--color-info-text", "#1d4ed8"],
] as const;

const BAND_SWATCHES = [
  ["--color-band-excellent", "#22c55e", "優秀 85–100"],
  ["--color-band-good", "#3b82f6", "良好 70–84"],
  ["--color-band-borderline", "#f59e0b", "及格邊緣 50–69"],
  ["--color-band-weak", "#ef4444", "落差大 0–49"],
] as const;

const SUNNY_SWATCHES = [
  ["--sunny-bg", "#fffcf4"],
  ["--sunny-ink", "#0f2430"],
  ["--sunny-accent", "#ffe134"],
  ["--sunny-onaccent", "#0f2430"],
  ["--sunny-secondary", "#60ceff"],
  ["--sunny-onsecondary", "#031e2d"],
] as const;

const SPACING = [
  ["--space-1", "0.25rem"],
  ["--space-2", "0.5rem"],
  ["--space-3", "0.75rem"],
  ["--space-4", "1rem"],
  ["--space-5", "1.25rem"],
  ["--space-6", "1.5rem"],
  ["--space-8", "2rem"],
  ["--space-10", "2.5rem"],
] as const;

const RADIUS = [
  ["--radius-sm", "0.25rem"],
  ["--radius-md", "0.375rem"],
  ["--radius-lg", "0.5rem"],
] as const;

const FONT_SIZES = [
  ["--font-xs", "0.75rem"],
  ["--font-sm", "0.875rem"],
  ["--font-base", "1rem"],
  ["--font-lg", "1.125rem"],
  ["--font-xl", "1.25rem"],
  ["--font-2xl", "1.5rem"],
] as const;

const SECTIONS = [
  ["colors", "顏色"],
  ["sunny", "陽光檸檬（首頁／onboarding）"],
  ["spacing", "間距"],
  ["radius", "圓角"],
  ["fonts", "字級"],
  ["typography", "標題與內文"],
  ["buttons", "按鈕"],
  ["forms", "表單元件"],
  ["upload", "檔案上傳元件"],
  ["cards", "卡片"],
  ["alerts", "提示訊息與徽章"],
  ["links", "連結"],
  ["table", "表格"],
  ["ats", "ATS 評分量表"],
  ["checklist", "JD 符合度清單"],
  ["experience", "經歷資料庫"],
] as const;

export default function DesignSystemPage() {
  return (
    <div className="page">
      <div className="page-container page-container--home">
        <div className="page-header">
          <div>
            <h1 className="heading-page">設計系統</h1>
            <p className="text-muted mt-1">
              全站樣式都在 <span className="ds-code">src/app/design-system.css</span>
              ，這頁只是拿來快速對照樣式長什麼樣子跟叫什麼名字，本身不是產品畫面。
            </p>
          </div>
          <Link href="/" className="link-muted">
            回首頁
          </Link>
        </div>

        <div className="card">
          <h2 className="heading-card">目錄</h2>
          <div className="ds-table-of-contents mt-3">
            {SECTIONS.map(([id, label]) => (
              <a key={id} href={`#${id}`} className="ds-code">
                {label}
              </a>
            ))}
          </div>
        </div>

        {/* 顏色 */}
        <section id="colors" className="ds-section">
          <h2 className="ds-section-title">顏色</h2>
          <p className="ds-section-desc">灰階由淺到深，語意顏色（錯誤/成功/警告/資訊），ATS 分數等級顏色。</p>

          <h3 className="heading-card mt-4">灰階（--color-neutral-*）</h3>
          <div className="ds-swatch-grid">
            {NEUTRAL_SWATCHES.map(([name, hex]) => (
              <div key={name} className="ds-item">
                <div className="ds-swatch-color" style={{ background: hex }} />
                <span className="ds-swatch-name">neutral-{name}</span>
                <span className="ds-swatch-value">{hex}</span>
              </div>
            ))}
          </div>

          <h3 className="heading-card mt-4">語意顏色</h3>
          <div className="ds-swatch-grid">
            {SEMANTIC_SWATCHES.map(([name, hex]) => (
              <div key={name} className="ds-item">
                <div className="ds-swatch-color" style={{ background: hex }} />
                <span className="ds-swatch-name">{name}</span>
                <span className="ds-swatch-value">{hex}</span>
              </div>
            ))}
          </div>

          <h3 className="heading-card mt-4">ATS 分數等級顏色</h3>
          <div className="ds-swatch-grid">
            {BAND_SWATCHES.map(([name, hex, desc]) => (
              <div key={name} className="ds-item">
                <div className="ds-swatch-color" style={{ background: hex }} />
                <span className="ds-swatch-name">{name}</span>
                <span className="ds-swatch-value">{desc}</span>
              </div>
            ))}
          </div>
        </section>

        <section id="sunny" className="ds-section">
          <h2 className="ds-section-title">陽光檸檬（首頁／onboarding）</h2>
          <p className="ds-section-desc">
            只用在使用者「還沒進入實際操作」的地方：onboarding 整頁、首頁最上方的品牌
            header。履歷畫布、經歷資料庫這類功能頁維持原本中性清爽的樣子，不要套用這組色。
          </p>

          <h3 className="heading-card mt-4">--sunny-*</h3>
          <div className="ds-swatch-grid">
            {SUNNY_SWATCHES.map(([name, hex]) => (
              <div key={name} className="ds-item">
                <div className="ds-swatch-color" style={{ background: hex }} />
                <span className="ds-swatch-name">{name}</span>
                <span className="ds-swatch-value">{hex}</span>
              </div>
            ))}
          </div>

          <h3 className="heading-card mt-4">套用方式</h3>
          <p className="text-body">
            外層容器加 <code>.sunny-surface</code>（背景＋文字色）。裝飾用的色塊放進
            <code>.blob-scene</code>（絕對定位、鋪滿父層），裡面放 1～4 個
            <code>.blob</code>／<code>.blob--1</code>～<code>.blob--4</code>。
            <strong>色塊的父層一定要是一個「有限高度」的區塊</strong>
            （例如 <code>.home-hero</code> 或包一層 <code>.blob-bounds</code>），
            不能直接包在 <code>.page</code> 這種 min-height:100vh
            的整頁容器外面，不然色塊的百分比位置會被拉爆，跑去蓋到內文。
          </p>

          <h3 className="heading-card mt-4">預覽</h3>
          <div className="home-hero blob-bounds sunny-surface">
            <div className="blob-scene" aria-hidden="true">
              <div className="blob blob--1" />
              <div className="blob blob--2" />
              <div className="blob blob--3" />
              <div className="blob blob--4" />
            </div>
            <div className="stack-tight">
              <h1 className="heading-page">jobahn</h1>
              <p className="text-muted">找工作的路</p>
            </div>
            <div className="toolbar-inline mt-3">
              <button type="button" className="btn btn-sunny">
                開始建立資料庫
              </button>
              <button type="button" className="btn btn-sunny-secondary">
                找工作的路
              </button>
            </div>
          </div>
        </section>

        {/* 間距 */}
        <section id="spacing" className="ds-section">
          <h2 className="ds-section-title">間距</h2>
          <p className="ds-section-desc">padding、margin、gap 都用這一套刻度，單位是 rem。</p>
          <div className="ds-col">
            {SPACING.map(([name, value]) => (
              <div key={name} className="ds-spacing-demo">
                <div className="ds-spacing-bar" style={{ width: value }} />
                <span className="ds-code">{name}</span>
                <span className="text-muted-xs">{value}</span>
              </div>
            ))}
          </div>
        </section>

        {/* 圓角 */}
        <section id="radius" className="ds-section">
          <h2 className="ds-section-title">圓角</h2>
          <div className="ds-row">
            {RADIUS.map(([name, value]) => (
              <div key={name} className="ds-item">
                <div className="ds-radius-box" style={{ borderRadius: value }} />
                <span className="ds-code">{name}</span>
                <span className="text-muted-xs">{value}</span>
              </div>
            ))}
          </div>
        </section>

        {/* 字級 */}
        <section id="fonts" className="ds-section">
          <h2 className="ds-section-title">字級</h2>
          <div className="ds-col">
            {FONT_SIZES.map(([name, value]) => (
              <div key={name} className="ds-spacing-demo">
                <span className="ds-font-sample" style={{ fontSize: value }}>
                  Aa 中文字級範例
                </span>
                <span className="ds-code">{name}</span>
                <span className="text-muted-xs">{value}</span>
              </div>
            ))}
          </div>
        </section>

        {/* 標題與內文 */}
        <section id="typography" className="ds-section">
          <h2 className="ds-section-title">標題與內文</h2>
          <div className="ds-col">
            <div className="ds-spacing-demo">
              <h3 className="heading-page">頁面標題文字</h3>
              <span className="ds-code">heading-page</span>
            </div>
            <div className="ds-spacing-demo">
              <h3 className="heading-auth">登入／註冊標題</h3>
              <span className="ds-code">heading-auth</span>
            </div>
            <div className="ds-spacing-demo">
              <h3 className="heading-card--lg">卡片大標題</h3>
              <span className="ds-code">heading-card--lg</span>
            </div>
            <div className="ds-spacing-demo">
              <h3 className="heading-card">卡片標題文字</h3>
              <span className="ds-code">heading-card</span>
            </div>
            <div className="ds-spacing-demo">
              <p className="text-body">一般內文文字（text-body）</p>
              <span className="ds-code">text-body</span>
            </div>
            <div className="ds-spacing-demo">
              <p className="text-muted">次要說明文字（text-muted）</p>
              <span className="ds-code">text-muted</span>
            </div>
            <div className="ds-spacing-demo">
              <p className="text-muted-xs">更小的輔助文字（text-muted-xs）</p>
              <span className="ds-code">text-muted-xs</span>
            </div>
          </div>
        </section>

        {/* 按鈕 */}
        <section id="buttons" className="ds-section">
          <h2 className="ds-section-title">按鈕</h2>
          <div className="ds-row">
            <div className="ds-item">
              <button className="btn btn-primary">主要按鈕</button>
              <span className="ds-code">btn btn-primary</span>
            </div>
            <div className="ds-item">
              <button className="btn btn-secondary">次要按鈕</button>
              <span className="ds-code">btn btn-secondary</span>
            </div>
            <div className="ds-item">
              <button className="btn btn-primary" disabled>
                停用狀態
              </button>
              <span className="ds-code">disabled</span>
            </div>
            <div className="ds-item">
              <button className="btn-link">文字連結按鈕</button>
              <span className="ds-code">btn-link</span>
            </div>
            <div className="ds-item">
              <button className="btn-toggle">未選取分頁</button>
              <span className="ds-code">btn-toggle</span>
            </div>
            <div className="ds-item">
              <button className="btn-toggle--active">已選取分頁</button>
              <span className="ds-code">btn-toggle--active</span>
            </div>
          </div>
        </section>

        {/* 表單元件 */}
        <section id="forms" className="ds-section">
          <h2 className="ds-section-title">表單元件</h2>
          <div className="ds-col ds-forms-demo">
            <div className="field">
              <label className="label">標籤文字（label）</label>
              <input className="input" placeholder="input" />
            </div>
            <div className="field">
              <label className="label">多行文字框（textarea）</label>
              <textarea className="textarea" rows={3} placeholder="textarea" />
            </div>
            <div className="checkbox-row">
              <label className="checkbox-label">
                <input type="checkbox" />
                核取方塊（checkbox-label）
              </label>
            </div>
          </div>
        </section>

        {/* 檔案上傳元件 */}
        <section id="upload" className="ds-section">
          <h2 className="ds-section-title">檔案上傳元件</h2>
          <p className="ds-section-desc">上傳履歷用的拖拉上傳元件（onboarding/OnboardingUpload.tsx、experience/UploadSourceCard.tsx）。</p>
          <div className="card ds-card-demo mt-4">
            <div className="file-drop-zone">
              <div className="file-drop-zone-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M7 18a4.5 4.5 0 0 1-.5-8.97A5 5 0 0 1 16.5 8H17a4 4 0 0 1 0 8h-1" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M12 11v8M9 15l3-3 3 3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <span className="file-drop-zone-text">拖曳檔案到這裡，或點擊選擇</span>
              <span className="file-drop-zone-hint">可一次選多個檔案，docx / doc / pdf，單檔 3MB 以內</span>
            </div>
            <div className="file-item-list">
              <div className="file-item">
                <div className="file-item-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M7 3h7l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M14 3v4h4M9 12h6M9 16h6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div className="file-item-body">
                  <div className="file-item-name">resume_v3.docx</div>
                  <div className="file-item-status">上傳中…</div>
                  <div className="file-item-progress-track">
                    <div className="file-item-progress-fill" />
                  </div>
                </div>
              </div>
              <div className="file-item">
                <div className="file-item-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M7 3h7l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M14 3v4h4M9 12h6M9 16h6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div className="file-item-body">
                  <div className="file-item-name">resume_v2.pdf</div>
                  <div className="file-item-status">已上傳 · 96 KB</div>
                </div>
                <span className="file-item-check">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <button type="button" className="file-item-remove">
                  刪除
                </button>
              </div>
              <div className="file-item file-item--error">
                <div className="file-item-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M7 3h7l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M14 3v4h4M9 12h6M9 16h6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div className="file-item-body">
                  <div className="file-item-name">photo.png</div>
                  <div className="file-item-status file-item-status--error">不是支援的檔案類型</div>
                </div>
                <button type="button" className="file-item-remove">
                  刪除
                </button>
              </div>
            </div>
          </div>
          <span className="ds-code mt-1">
            file-drop-zone / file-item / file-item--error / file-item-progress-fill / file-item-check
          </span>
        </section>

        {/* 卡片 */}
        <section id="cards" className="ds-section">
          <h2 className="ds-section-title">卡片</h2>
          <div className="ds-row ds-row--top">
            <div>
              <div className="card">一般卡片內容</div>
              <span className="ds-code mt-1">card</span>
            </div>
            <div>
              <div className="card card--sm">較窄內距的卡片</div>
              <span className="ds-code mt-1">card card--sm</span>
            </div>
            <div>
              <div className="card card--dashed">虛線邊框卡片</div>
              <span className="ds-code mt-1">card card--dashed</span>
            </div>
            <div>
              <div className="card-toolbar">
                <button className="btn btn-secondary">按鈕</button>
                <button className="btn btn-secondary">按鈕</button>
              </div>
              <span className="ds-code mt-1">card-toolbar</span>
            </div>
          </div>
        </section>

        {/* 提示訊息與徽章 */}
        <section id="alerts" className="ds-section">
          <h2 className="ds-section-title">提示訊息與徽章</h2>
          <div className="ds-col">
            <div className="ds-spacing-demo">
              <div className="alert alert-error">錯誤提示文字</div>
              <span className="ds-code">alert alert-error</span>
            </div>
            <div className="ds-spacing-demo">
              <div className="alert alert-success">成功提示文字</div>
              <span className="ds-code">alert alert-success</span>
            </div>
            <div className="ds-spacing-demo">
              <div className="alert alert-warning">警告提示文字</div>
              <span className="ds-code">alert alert-warning</span>
            </div>
            <div className="ds-spacing-demo">
              <span className="text-error">單純紅字（不加底色）</span>
              <span className="ds-code">text-error</span>
            </div>
            <div className="ds-spacing-demo">
              <span className="text-success">單純綠字（不加底色）</span>
              <span className="ds-code">text-success</span>
            </div>
            <div className="ds-spacing-demo">
              <span className="badge badge-success">徽章文字</span>
              <span className="ds-code">badge badge-success</span>
            </div>
            <div className="ds-spacing-demo">
              <span className="finalized-tag">已定案，畫布唯讀</span>
              <span className="ds-code">finalized-tag</span>
            </div>
          </div>
        </section>

        {/* 連結 */}
        <section id="links" className="ds-section">
          <h2 className="ds-section-title">連結</h2>
          <div className="ds-col">
            <div className="ds-spacing-demo">
              <a href="#" className="link">
                粗體底線連結
              </a>
              <span className="ds-code">link</span>
            </div>
            <div className="ds-spacing-demo">
              <a href="#" className="link-muted">
                灰色小字連結
              </a>
              <span className="ds-code">link-muted</span>
            </div>
            <div className="ds-spacing-demo">
              <a href="#" className="link-table">
                表格內連結
              </a>
              <span className="ds-code">link-table</span>
            </div>
          </div>
        </section>

        {/* 表格 */}
        <section id="table" className="ds-section">
          <h2 className="ds-section-title">表格</h2>
          <div className="table-wrap mt-4">
            <table className="data-table">
              <thead>
                <tr>
                  <th>公司</th>
                  <th>狀態</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>範例公司</td>
                  <td>draft</td>
                </tr>
              </tbody>
            </table>
          </div>
          <span className="ds-code mt-1">table-wrap / data-table</span>
        </section>

        {/* ATS 評分量表 */}
        <section id="ats" className="ds-section">
          <h2 className="ds-section-title">ATS 評分量表</h2>
          <div className="card card--sm ds-card-demo--sm mt-4">
            <p className="ats-score-value">
              76<span className="ats-score-max"> / 100</span>
              <span className="ats-band-tag ats-band-good">良好</span>
            </p>
            <div className="ats-scale">
              <div className="ats-scale-bar">
                <div className="ats-scale-bar-segment ats-scale-bar-segment--weak" />
                <div className="ats-scale-bar-segment ats-scale-bar-segment--borderline" />
                <div className="ats-scale-bar-segment ats-scale-bar-segment--good" />
                <div className="ats-scale-bar-segment ats-scale-bar-segment--excellent" />
              </div>
              <ul className="ats-scale-legend">
                <li className="ats-scale-legend-item">
                  <span className="ats-scale-dot ats-band-excellent" />
                  <span>85–100 分・優秀</span>
                </li>
                <li className="ats-scale-legend-item ats-scale-legend-item--current ats-band-good">
                  <span className="ats-scale-dot ats-band-good" />
                  <span>70–84 分・良好（目前分數在這一級）</span>
                </li>
                <li className="ats-scale-legend-item">
                  <span className="ats-scale-dot ats-band-borderline" />
                  <span>50–69 分・及格邊緣</span>
                </li>
                <li className="ats-scale-legend-item">
                  <span className="ats-scale-dot ats-band-weak" />
                  <span>0–49 分・落差大</span>
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* JD 符合度清單 */}
        <section id="checklist" className="ds-section">
          <h2 className="ds-section-title">JD 符合度清單</h2>
          <div className="card card--sm ds-card-demo mt-4">
            <ul className="checklist">
              <li className="checklist-item">
                <span>✅</span>
                <span className="checklist-item-text">
                  已符合的項目<span className="checklist-item-source">（resume）</span>
                </span>
              </li>
              <li className="checklist-item">
                <span>⚠️</span>
                <span className="checklist-item-text">尚未符合的項目</span>
              </li>
            </ul>
          </div>
        </section>

        {/* 經歷資料庫 */}
        <section id="experience" className="ds-section">
          <h2 className="ds-section-title">經歷資料庫</h2>
          <p className="ds-section-desc">
            同一件事的不同寫法（variant）用柔和的資訊色標籤標註強調重點，不用紅字/底線（那是錯誤語意），
            對應 <span className="ds-code">/experience</span> 頁面。
          </p>
          <div className="card ds-card-demo mt-4">
            <div className="exp-entry resume-block">
              <div className="resume-row">
                <span className="resume-row-left">範例公司股份有限公司</span>
                <span className="resume-row-right">Taipei City, Taiwan</span>
              </div>
              <div className="exp-role-row resume-row resume-row--role">
                <span className="resume-row-left">產品經理</span>
                <span className="resume-row-right">Jan. 2023 – Present</span>
              </div>
              <div className="resume-bullets">
                <div className="exp-achievement">
                  <div className="exp-variant">
                    <span className="resume-bullet-dot">{"•"}</span>
                    <div className="exp-variant-bullet">
                      <span>推動跨部門專案，將產品上線時程縮短 30%。</span>
                      <span className="exp-variant-tag">強調專案管理與效率提升</span>
                    </div>
                    <button type="button" className="exp-variant-remove">
                      刪除
                    </button>
                  </div>
                  <div className="exp-variant">
                    <span className="resume-bullet-dot">{"•"}</span>
                    <div className="exp-variant-bullet">
                      <span>帶領跨部門團隊重整開發流程，把交付週期從 6 週壓縮到 4 週。</span>
                      <span className="exp-variant-tag">強調流程優化與量化成果</span>
                    </div>
                    <button type="button" className="exp-variant-remove">
                      刪除
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
