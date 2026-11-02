import { Downloader } from "@/components/Downloader";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SITE } from "@/lib/site";

const steps = [
  {
    title: "Dán liên kết",
    description:
      "Sao chép URL của video YouTube, Shorts hoặc YouTube Music rồi dán vào ô phía trên.",
  },
  {
    title: "Chọn chất lượng",
    description:
      "Chọn bitrate MP3 128, 192 hoặc 320 kbps phù hợp với nhu cầu nghe nhạc của bạn.",
  },
  {
    title: "Tải xuống",
    description:
      "Nhấn Tải MP3. File được mã hoá ngay trên thiết bị của bạn rồi tự động lưu về máy.",
  },
];

const faqs = [
  {
    question: "Trang này có miễn phí không?",
    answer:
      "Có. Bạn có thể chuyển đổi và tải nhạc miễn phí, không cần đăng ký tài khoản và không có quảng cáo xen ngang.",
  },
  {
    question: "Tôi có cần cài đặt phần mềm gì không?",
    answer:
      "Không. Mọi thứ chạy trong trình duyệt. Bạn chỉ cần một trình duyệt hiện đại như Chrome, Edge, Firefox hoặc Safari.",
  },
  {
    question: "Vì sao quá trình chuyển đổi diễn ra trên trình duyệt?",
    answer:
      "Âm thanh được tải qua máy chủ để tránh bị chặn, sau đó được giải mã và mã hoá thành MP3 ngay trên thiết bị của bạn. Cách này giúp file không bị lưu lại trên máy chủ.",
  },
  {
    question: "Tôi có thể tải video dài không?",
    answer:
      "Trình duyệt chỉ chuyển MP3 cho video dưới 15 phút để tránh hết bộ nhớ. Với video dài hơn, bạn có thể dùng nút “Tải bản gốc” để lấy file M4A/WebM.",
  },
  {
    question: "Trang có lưu video hay file của tôi không?",
    answer:
      "Không. Chúng tôi không lưu file âm thanh hay thông tin tải xuống. File MP3 được tạo và lưu trực tiếp trên thiết bị của bạn.",
  },
  {
    question: "Tôi được phép tải nội dung nào?",
    answer:
      "Chỉ tải nội dung mà bạn sở hữu hoặc có quyền sử dụng. Hãy tôn trọng bản quyền và điều khoản của YouTube.",
  },
];

export default function HomePage() {
  return (
    <>
      <header className="site-header">
        <div className="wrap nav">
          <a className="brand" href="#top" aria-label={`${SITE.name} — về đầu trang`}>
            <span className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path
                  d="M9 17V7l9-2v10"
                  fill="none"
                  stroke="#fff"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="6.5" cy="17" r="2.5" fill="#fff" />
                <circle cx="15.5" cy="15" r="2.5" fill="#fff" />
              </svg>
            </span>
            <span className="brand-text">
              <strong>{SITE.name}</strong>
              <small>{SITE.tagline}</small>
            </span>
          </a>

          <div className="nav-actions">
            <nav className="nav-links" aria-label="Điều hướng chính">
              <a href="#how">Cách hoạt động</a>
              <a href="#faq">Câu hỏi thường gặp</a>
              {SITE.repo ? (
                <a href={SITE.repo} target="_blank" rel="noreferrer">
                  GitHub
                </a>
              ) : null}
            </nav>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="wrap">
            <span className="badge">
              <span className="pulse" aria-hidden="true" />
              Miễn phí · Không quảng cáo · Không cần đăng ký
            </span>

            <h1>
              Chuyển video YouTube
              <br />
              thành <span className="gradient-text">MP3</span> chất lượng cao
            </h1>

            <p className="lead">
              Dán link, chọn chất lượng và tải về. Quá trình chuyển đổi diễn ra ngay trên trình
              duyệt của bạn — nhanh, riêng tư và không cần cài đặt.
            </p>

            <Downloader />

            <div className="trust-row">
              <span>Không lưu file</span>
              <span>Không cần cài đặt</span>
              <span>Hỗ trợ mọi thiết bị</span>
            </div>
          </div>
        </section>

        <section id="how" className="section">
          <div className="wrap">
            <div className="section-head">
              <span className="eyebrow">Cách hoạt động</span>
              <h2>Ba bước để có file MP3</h2>
              <p>Không tài khoản, không phần mềm, không chờ đợi.</p>
            </div>

            <div className="steps">
              {steps.map((step, index) => (
                <article className="step" key={step.title}>
                  <span className="step-num" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section section-tight">
          <div className="wrap">
            <div className="feature-grid">
              <div className="feature">
                <span className="feature-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path
                      d="M12 3 5 6v5c0 4.4 2.9 8.4 7 10 4.1-1.6 7-5.6 7-10V6l-7-3Z"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinejoin="round"
                    />
                    <path
                      d="m9 12 2 2 4-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <h3>Riêng tư</h3>
                <p>File MP3 được tạo trên thiết bị của bạn, không lưu trữ trên máy chủ.</p>
              </div>

              <div className="feature">
                <span className="feature-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path
                      d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5Z"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <h3>Nhanh</h3>
                <p>Không hàng chờ, không giới hạn lượt tải. Chuyển đổi trong vài giây.</p>
              </div>

              <div className="feature">
                <span className="feature-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path
                      d="M4 15v-3a8 8 0 0 1 16 0v3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                    />
                    <rect
                      x="3"
                      y="14"
                      width="4"
                      height="7"
                      rx="1.6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                    />
                    <rect
                      x="17"
                      y="14"
                      width="4"
                      height="7"
                      rx="1.6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                    />
                  </svg>
                </span>
                <h3>Chất lượng cao</h3>
                <p>Chọn 128, 192 hoặc 320 kbps và giữ trọn âm thanh gốc từ YouTube.</p>
              </div>
            </div>
          </div>
        </section>

        <section id="faq" className="section">
          <div className="wrap faq-wrap">
            <div className="section-head">
              <span className="eyebrow">Câu hỏi thường gặp</span>
              <h2>Bạn cần biết gì?</h2>
            </div>

            <div className="faq">
              {faqs.map((item) => (
                <details key={item.question}>
                  <summary>
                    <span>{item.question}</span>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="m6 9 6 6 6-6"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </summary>
                  <p>{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="wrap footer-inner">
          <div className="footer-brand">
            <span className="brand-mark small" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path
                  d="M9 17V7l9-2v10"
                  fill="none"
                  stroke="#fff"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="6.5" cy="17" r="2.5" fill="#fff" />
                <circle cx="15.5" cy="15" r="2.5" fill="#fff" />
              </svg>
            </span>
            <div>
              <strong>{SITE.name}</strong>
              <p>{SITE.tagline} — nhanh, sạch, không quảng cáo.</p>
            </div>
          </div>

          <p className="disclaimer">
            {SITE.name} không liên kết với YouTube. Chỉ tải nội dung bạn sở hữu hoặc được phép sử
            dụng. Hãy tôn trọng bản quyền.
          </p>
        </div>
      </footer>
    </>
  );
}
