import type { Metadata } from "next";
import Link from "next/link";

import Logo from "@/components/Logo";
import { PublicNav } from "@/components/landing/PublicNav";

export const metadata: Metadata = {
  title: "Chính sách bảo mật | UPTECH KNOWLEDGE",
  description:
    "Cách Uptech thu thập, sử dụng, lưu trữ, bảo vệ và chia sẻ thông tin cá nhân.",
};

type PrivacySection = Readonly<{
  title: string;
  paragraphs?: readonly string[];
  items?: readonly string[];
}>;

const sections: readonly PrivacySection[] = [
  {
    title: "Mục đích và phạm vi áp dụng",
    paragraphs: [
      "Chính sách này giải thích cách Uptech thu thập, sử dụng, lưu trữ, bảo vệ và chia sẻ thông tin cá nhân khi bạn truy cập website hoặc gửi yêu cầu cho chúng tôi.",
      "Chính sách áp dụng cho website uptech.vn, các biểu mẫu liên hệ, đăng ký nhận thông tin, tuyển dụng, yêu cầu tư vấn, yêu cầu báo giá, yêu cầu hợp tác và các trao đổi ban đầu với Uptech.",
      "Chính sách này không thay thế thỏa thuận bảo mật, hợp đồng dịch vụ, điều khoản xử lý dữ liệu hoặc tài liệu dự án riêng nếu hai bên ký kết trong quá trình hợp tác.",
      "Uptech xử lý thông tin theo nguyên tắc minh bạch, đúng mục đích, tối thiểu hóa dữ liệu cần thu thập và bảo vệ dữ liệu trong phạm vi kiểm soát hợp lý. Uptech không bán thông tin cá nhân của bạn.",
    ],
  },
  {
    title: "Thông tin Uptech thu thập",
    paragraphs: [
      "Uptech chỉ thu thập những nhóm thông tin cần thiết để phản hồi yêu cầu, tư vấn giải pháp, vận hành website và bảo vệ hệ thống.",
    ],
    items: [
      "Thông tin định danh và liên hệ như họ tên, email, số điện thoại, tên công ty, phòng ban hoặc chức danh nếu bạn chủ động cung cấp.",
      "Nội dung trao đổi như mô tả nhu cầu, yêu cầu tư vấn, yêu cầu báo giá, thông tin dự án, hồ sơ tuyển dụng hoặc tài liệu bạn gửi cho Uptech.",
      "Thông tin doanh nghiệp như tên pháp nhân, mã số thuế, địa chỉ xuất hóa đơn hoặc thông tin đầu mối làm việc nếu cần chuẩn bị báo giá, hợp đồng hoặc hồ sơ mua sắm.",
      "Thông tin kỹ thuật cơ bản như địa chỉ IP, trình duyệt, thiết bị, trang đã truy cập, thời điểm truy cập và tín hiệu bảo mật nhằm vận hành website ổn định.",
      "Lựa chọn đồng ý nhận bản tin, tài liệu chuyên môn, lời mời sự kiện hoặc các nội dung cập nhật từ Uptech.",
      "Thông tin phát sinh trong quá trình hỗ trợ như lịch sử phản hồi, trạng thái yêu cầu, ghi chú chăm sóc khách hàng hoặc kết quả trao đổi ban đầu.",
    ],
  },
  {
    title: "Thông tin không bắt buộc cung cấp",
    paragraphs: [
      "Bạn có thể chọn không cung cấp một số thông tin cá nhân. Tuy nhiên, điều này có thể làm Uptech không đủ dữ liệu để phản hồi hoặc chuẩn bị tài liệu phù hợp.",
    ],
    items: [
      "Bạn không cần gửi thông tin nhạy cảm, dữ liệu bí mật kinh doanh hoặc dữ liệu cá nhân của bên thứ ba nếu nội dung đó chưa cần thiết cho giai đoạn trao đổi ban đầu.",
      "Nếu biểu mẫu có trường không bắt buộc, bạn có thể bỏ trống mà vẫn gửi yêu cầu trong phạm vi hệ thống cho phép.",
      "Nếu cần chia sẻ tài liệu dự án, dữ liệu khách hàng hoặc thông tin nội bộ, hai bên nên thống nhất phạm vi bảo mật hoặc ký thỏa thuận riêng trước khi gửi.",
    ],
  },
  {
    title: "Cách thông tin được thu thập",
    paragraphs: [
      "Thông tin có thể được thu thập trực tiếp từ bạn, tự động qua website hoặc từ nguồn hợp lệ liên quan đến yêu cầu làm việc.",
      "Phần lớn thông tin được thu thập trực tiếp từ bạn khi bạn điền biểu mẫu, gửi email, gọi điện, đăng ký nhận tài liệu, trao đổi tuyển dụng hoặc làm việc với đội ngũ Uptech.",
    ],
    items: [
      "Thu thập trực tiếp khi bạn chủ động cung cấp thông tin qua website, email, điện thoại, sự kiện, cuộc họp hoặc kênh liên hệ chính thức.",
      "Thu thập tự động ở mức kỹ thuật khi bạn truy cập website, ví dụ trang đã xem, thời gian truy cập, trình duyệt, thiết bị và tín hiệu bảo mật cơ bản.",
      "Thu thập từ tổ chức, đồng nghiệp, đối tác tuyển dụng, đối tác triển khai hoặc nền tảng bên thứ ba trong phạm vi phù hợp với mục đích làm việc đã được thông báo.",
    ],
  },
  {
    title: "Mục đích sử dụng thông tin",
    paragraphs: [
      "Thông tin được sử dụng trong phạm vi hợp lý với nội dung bạn cung cấp và nhu cầu làm việc giữa bạn, tổ chức của bạn và Uptech.",
    ],
    items: [
      "Liên hệ lại, xác minh thông tin, làm rõ nhu cầu và gửi đề xuất phù hợp.",
      "Tư vấn dịch vụ, chuẩn bị báo giá, hợp đồng, hồ sơ mua sắm, tài liệu kỹ thuật hoặc sắp xếp buổi trao đổi.",
      "Cung cấp tài liệu, bản tin, lời mời sự kiện hoặc nội dung chuyên môn khi bạn đăng ký nhận thông tin.",
      "Quản lý yêu cầu tuyển dụng, hợp tác, chăm sóc khách hàng, hỗ trợ sau trao đổi và duy trì lịch sử làm việc cần thiết.",
      "Phân tích hiệu quả website, cải thiện nội dung, cải thiện trải nghiệm người dùng, bảo đảm an toàn hệ thống và nâng cao chất lượng dịch vụ.",
      "Thực hiện nghĩa vụ theo quy định pháp luật hiện hành khi có yêu cầu hợp lệ từ cơ quan có thẩm quyền.",
    ],
  },
  {
    title: "Chia sẻ và bên xử lý dữ liệu",
    paragraphs: [
      "Uptech không bán thông tin cá nhân. Việc chia sẻ dữ liệu chỉ thực hiện khi cần thiết cho mục đích đã nêu hoặc để đáp ứng nghĩa vụ hợp lệ.",
    ],
    items: [
      "Nhà cung cấp hạ tầng, lưu trữ, email, CRM, phân tích dữ liệu, bảo mật hoặc công cụ vận hành có thể xử lý dữ liệu trong phạm vi hỗ trợ Uptech vận hành website và phản hồi yêu cầu.",
      "Đối tác chuyên môn hoặc nhà thầu phụ có thể được tiếp cận thông tin cần thiết nếu họ tham gia đánh giá, tư vấn hoặc chuẩn bị đề xuất cho nhu cầu của bạn.",
      "Cơ quan nhà nước, tòa án hoặc bên có thẩm quyền có thể được cung cấp thông tin khi có yêu cầu hợp lệ theo quy định pháp luật.",
      "Trong mọi trường hợp, Uptech giới hạn phạm vi chia sẻ ở mức cần thiết và yêu cầu các bên liên quan bảo vệ thông tin phù hợp với vai trò xử lý của họ.",
    ],
  },
  {
    title: "Cách Uptech bảo vệ dữ liệu",
    paragraphs: [
      "Chúng tôi áp dụng các biện pháp kỹ thuật và tổ chức phù hợp để hạn chế truy cập trái phép, mất mát, lạm dụng hoặc tiết lộ ngoài phạm vi cần thiết.",
    ],
    items: [
      "Chỉ nhân sự có trách nhiệm xử lý yêu cầu mới được tiếp cận thông tin liên quan.",
      "Hệ thống lưu trữ và công cụ vận hành được cấu hình theo hướng phân quyền truy cập, ghi nhận hoạt động, sao lưu phù hợp và kiểm soát thay đổi.",
      "Thông tin nhạy cảm trong trao đổi dự án được xử lý cẩn trọng theo phạm vi công việc, thỏa thuận bảo mật và quy trình nội bộ giữa các bên.",
      "Nhân sự và bên liên quan được khuyến nghị chỉ sử dụng dữ liệu cho đúng mục đích xử lý, không tự ý sao chép, chuyển tiếp hoặc sử dụng ngoài phạm vi được giao.",
      "Khi phát hiện sự cố có khả năng ảnh hưởng đến dữ liệu cá nhân, Uptech sẽ rà soát, khắc phục, hạn chế tác động và thông báo theo yêu cầu pháp luật hiện hành.",
    ],
  },
  {
    title: "Thời gian lưu trữ",
    paragraphs: [
      "Uptech lưu trữ thông tin trong thời gian cần thiết cho mục đích xử lý, quan hệ làm việc và nghĩa vụ pháp lý liên quan.",
    ],
    items: [
      "Thông tin liên hệ và yêu cầu tư vấn có thể được lưu trong thời gian cần thiết để phản hồi, theo dõi, chăm sóc khách hàng hoặc xử lý trao đổi tiếp theo.",
      "Thông tin phục vụ báo giá, hợp đồng, hóa đơn, kế toán hoặc hồ sơ mua sắm có thể được lưu theo thời hạn cần thiết cho nghĩa vụ pháp lý, thuế, kiểm toán và quản trị nội bộ.",
      "Thông tin kỹ thuật, log truy cập hoặc tín hiệu bảo mật có thể được lưu trong thời gian phù hợp để vận hành website, phân tích sự cố và bảo vệ hệ thống.",
      "Khi thông tin không còn cần thiết hoặc khi có yêu cầu xóa hợp lệ, Uptech sẽ xóa, ẩn danh hoặc hạn chế xử lý theo khả năng kỹ thuật và quy định hiện hành.",
    ],
  },
  {
    title: "Quyền của bạn đối với dữ liệu cá nhân",
    paragraphs: [
      "Bạn có thể chủ động kiểm soát thông tin cá nhân đã cung cấp cho Uptech trong phạm vi quy định hiện hành và khả năng xác minh hợp lý.",
    ],
    items: [
      "Yêu cầu xác nhận, truy cập hoặc nhận bản sao thông tin cá nhân liên quan đến bạn.",
      "Yêu cầu chỉnh sửa khi thông tin chưa chính xác hoặc chưa đầy đủ.",
      "Rút lại sự đồng ý nhận bản tin, nội dung marketing hoặc các trao đổi không còn phù hợp với nhu cầu của bạn.",
      "Yêu cầu xóa, hạn chế xử lý hoặc phản đối một số hoạt động xử lý nếu có căn cứ phù hợp theo quy định hiện hành.",
      "Yêu cầu giải thích về mục đích xử lý, phạm vi chia sẻ hoặc cách Uptech bảo vệ dữ liệu trong phạm vi có thể cung cấp.",
      "Gửi câu hỏi, khiếu nại hoặc yêu cầu hỗ trợ về dữ liệu cá nhân qua email info [at] uptech [dot] vn.",
    ],
  },
  {
    title: "Cách gửi và xác minh yêu cầu",
    paragraphs: [
      "Để bảo vệ dữ liệu, Uptech có thể cần xác minh danh tính hoặc quyền đại diện trước khi xử lý một số yêu cầu liên quan đến thông tin cá nhân.",
    ],
    items: [
      "Bạn có thể gửi yêu cầu qua email info [at] uptech [dot] vn, kèm thông tin liên hệ và mô tả rõ nội dung cần hỗ trợ.",
      "Nếu yêu cầu liên quan đến dữ liệu của tổ chức, hợp đồng, hóa đơn hoặc hồ sơ dự án, Uptech có thể yêu cầu xác minh vai trò đại diện hợp lệ.",
      "Uptech sẽ phản hồi trong thời gian hợp lý sau khi nhận đủ thông tin cần thiết để xác minh và xử lý yêu cầu.",
      "Một số yêu cầu có thể bị từ chối hoặc giới hạn nếu ảnh hưởng đến quyền lợi hợp pháp của bên khác, nghĩa vụ lưu trữ, bảo mật hệ thống hoặc yêu cầu pháp lý hiện hành.",
    ],
  },
  {
    title: "Cookie và công nghệ đo lường",
    paragraphs: [
      "Website có thể sử dụng cookie hoặc công nghệ tương tự để vận hành ổn định, ghi nhớ lựa chọn, đo lường hiệu quả nội dung và bảo vệ hệ thống.",
    ],
    items: [
      "Cookie cần thiết giúp website hoạt động, duy trì phiên truy cập, bảo mật biểu mẫu và giảm rủi ro truy cập bất thường.",
      "Cookie phân tích hoặc công cụ đo lường giúp Uptech hiểu cách người dùng tương tác với nội dung để cải thiện cấu trúc, tốc độ và trải nghiệm.",
      "Bạn có thể điều chỉnh cookie trong trình duyệt. Một số tính năng có thể hoạt động chưa đầy đủ nếu cookie bị tắt hoàn toàn.",
    ],
  },
  {
    title: "Liên kết đến website và nền tảng bên ngoài",
    paragraphs: [
      "Website Uptech có thể dẫn đến website, mạng xã hội, nền tảng tuyển dụng, nhà cung cấp hạ tầng, đối tác hoặc công cụ bên thứ ba. Các nền tảng này có chính sách bảo mật và điều khoản riêng.",
      "Uptech không chịu trách nhiệm cho cách bên thứ ba thu thập, sử dụng hoặc bảo vệ thông tin khi bạn rời khỏi website Uptech. Bạn nên đọc chính sách của từng nền tảng trước khi cung cấp dữ liệu cá nhân.",
    ],
  },
  {
    title: "Cập nhật chính sách",
    paragraphs: [
      "Uptech có thể cập nhật chính sách bảo mật để phản ánh thay đổi về website, dịch vụ, công nghệ, quy trình vận hành hoặc yêu cầu pháp lý. Phiên bản mới có hiệu lực khi được đăng tải trên website, trừ khi có thông báo khác trong từng trường hợp cụ thể.",
      "Ngày cập nhật được hiển thị ở đầu trang để bạn dễ nhận biết phiên bản mới nhất.",
    ],
  },
  {
    title: "Liên hệ về dữ liệu cá nhân",
    paragraphs: [
      "Nếu bạn cần làm rõ nội dung chính sách hoặc gửi yêu cầu liên quan đến dữ liệu cá nhân, vui lòng liên hệ Uptech qua kênh chính thức dưới đây.",
    ],
    items: [
      "Đơn vị quản lý thông tin: Công ty TNHH Giải Pháp Công Nghệ Uptech.",
      "Địa chỉ: Tầng 2, B2 đường Nguyễn Hữu Thọ, Phường Tân Hưng, TP. Hồ Chí Minh.",
      "Email: info [at] uptech [dot] vn. Điện thoại: +(84) 968 726 135.",
    ],
  },
];

function PolicySection({ section }: { readonly section: PrivacySection }) {
  return (
    <section className="border-t border-[var(--border-subtle)] pt-8 sm:pt-10">
      <h2 className="text-balance text-2xl font-semibold tracking-[-0.025em] text-[var(--text-primary)] sm:text-3xl">
        {section.title}
      </h2>
      {section.paragraphs?.map((paragraph) => (
        <p key={paragraph} className="mt-4 text-pretty text-sm leading-7 text-[var(--text-secondary)] sm:text-base sm:leading-8">
          {paragraph}
        </p>
      ))}
      {section.items ? (
        <ul data-legal-list="natural" className="mt-5 space-y-3">
          {section.items.map((item) => (
            <li
              key={item}
              className="relative pl-5 text-sm leading-7 text-[var(--text-secondary)] before:absolute before:left-0 before:top-[0.7rem] before:size-1.5 before:rounded-full before:bg-blue-500 sm:text-base sm:leading-8 sm:before:top-[0.82rem]"
            >
              {item}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-dvh bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <PublicNav />
      <main id="main-content" className="px-4 pb-20 pt-32 sm:px-6 sm:pb-28 sm:pt-40 lg:px-8">
        <article className="mx-auto max-w-4xl">
          <header className="rounded-[2rem] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6 shadow-[var(--panel-shadow)] sm:p-10 lg:p-12">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-500">UPTECH KNOWLEDGE</p>
            <h1 className="mt-4 text-balance text-4xl font-bold tracking-[-0.045em] text-[var(--text-primary)] sm:text-5xl">
              Chính sách bảo mật
            </h1>
            <p className="mt-5 max-w-3xl text-pretty text-base leading-8 text-[var(--text-secondary)] sm:text-lg">
              Uptech tôn trọng quyền riêng tư và xử lý thông tin cá nhân theo hướng rõ ràng, có mục đích và đủ an toàn cho quá trình tư vấn, tuyển dụng, hợp tác và cung cấp dịch vụ.
            </p>
            <dl className="mt-7 flex flex-wrap gap-x-8 gap-y-3 border-t border-[var(--border-subtle)] pt-6 text-sm text-[var(--text-muted)]">
              <div className="flex gap-2"><dt className="font-semibold text-[var(--text-secondary)]">Cập nhật:</dt><dd>02/06/2026</dd></div>
              <div className="flex gap-2"><dt className="font-semibold text-[var(--text-secondary)]">Hiệu lực:</dt><dd>02/06/2026</dd></div>
            </dl>
          </header>

          <section className="mt-10 rounded-[2rem] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6 shadow-[var(--panel-shadow)] sm:p-10 lg:p-12">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-500">Đơn vị quản lý dữ liệu</p>
            <h2 className="mt-4 text-xl font-semibold text-[var(--text-primary)] sm:text-2xl">Công ty TNHH Giải Pháp Công Nghệ Uptech</h2>
            <address className="mt-4 space-y-1 text-sm not-italic leading-7 text-[var(--text-secondary)] sm:text-base">
              <p>Tầng 2, B2 Nguyễn Hữu Thọ, Phường Tân Hưng, TP. Hồ Chí Minh</p>
              <p>Email: info [at] uptech [dot] vn</p>
              <p>Điện thoại: +(84) 968 726 135</p>
            </address>
          </section>

          <div className="mt-10 space-y-10 rounded-[2rem] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6 shadow-[var(--panel-shadow)] sm:p-10 lg:p-12">
            {sections.map((section) => <PolicySection key={section.title} section={section} />)}
            <p className="border-t border-[var(--border-subtle)] pt-8 text-sm leading-7 text-[var(--text-secondary)] sm:text-base sm:leading-8">
              Nếu bạn cần làm rõ nội dung trên trang này, vui lòng liên hệ Uptech qua email hoặc +(84) 968 726 135.
            </p>
          </div>
        </article>
      </main>

      <footer className="border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-4xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/" aria-label="UPTECH KNOWLEDGE - Trang chủ" className="inline-flex min-h-11 items-center gap-3">
            <Logo className="h-7 w-auto" />
            <span className="border-l border-[var(--border-default)] pl-3 text-xs font-bold tracking-[0.2em] text-[var(--text-secondary)]">KNOWLEDGE</span>
          </Link>
          <Link href="/" className="inline-flex min-h-11 items-center text-sm font-medium text-blue-500 transition-colors hover:text-blue-400">Về trang chủ</Link>
        </div>
      </footer>
    </div>
  );
}
