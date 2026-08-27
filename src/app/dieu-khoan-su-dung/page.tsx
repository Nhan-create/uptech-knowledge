import type { Metadata } from "next";
import Link from "next/link";

import Logo from "@/components/Logo";
import { PublicNav } from "@/components/landing/PublicNav";

export const metadata: Metadata = {
  title: "Điều khoản sử dụng | UPTECH KNOWLEDGE",
  description:
    "Các nguyên tắc pháp lý khi truy cập, sử dụng nội dung, gửi biểu mẫu và tương tác với website Uptech.",
};

type TermsSection = Readonly<{
  title: string;
  paragraphs?: readonly string[];
  items?: readonly string[];
}>;

const sections: readonly TermsSection[] = [
  {
    title: "Giới thiệu và chấp nhận điều khoản",
    paragraphs: [
      "Chào mừng bạn truy cập website chính thức của Uptech. Vui lòng đọc kỹ các điều khoản dưới đây trước khi sử dụng nội dung, biểu mẫu hoặc bất kỳ chức năng nào trên website.",
      "Thông qua việc truy cập, duyệt nội dung, gửi thông tin hoặc sử dụng bất kỳ tài nguyên nào trên uptech.vn, bạn xác nhận rằng bạn đã đọc, hiểu và đồng ý tuân thủ Điều khoản sử dụng này.",
      "Nếu bạn không đồng ý với một phần hoặc toàn bộ điều khoản, vui lòng ngừng truy cập website. Nếu cần làm rõ nội dung, bạn có thể liên hệ Uptech qua kênh liên hệ chính thức trước khi tiếp tục sử dụng.",
      "Điều khoản này áp dụng cho website công khai của Uptech. Trường hợp có hợp đồng dịch vụ, báo giá, thỏa thuận bảo mật, thỏa thuận xử lý dữ liệu hoặc phụ lục dự án riêng giữa các bên, các tài liệu đó sẽ được ưu tiên áp dụng trong phạm vi nội dung đã thỏa thuận.",
    ],
  },
  {
    title: "Bản quyền, thương hiệu và sở hữu trí tuệ",
    paragraphs: [
      "Uptech tuyên bố quyền sở hữu hoặc quyền sử dụng hợp pháp đối với các tài sản trí tuệ được thể hiện trên website, trừ khi có ghi chú khác.",
      "Website này và các nội dung thuộc website, bao gồm nhưng không giới hạn ở tên thương mại, logo, giao diện, thiết kế, hình ảnh, video, bài viết, tài liệu, mô tả dịch vụ, biểu mẫu, mã nguồn hiển thị công khai, dữ liệu cấu trúc và cách sắp xếp nội dung, thuộc quyền sở hữu hoặc quyền sử dụng hợp pháp của Uptech và/hoặc bên cấp phép cho Uptech.",
      "Các quyền sở hữu trí tuệ liên quan đến mô hình, phương pháp, quy trình, framework, tài liệu chuyên môn, phần mềm, công cụ, thuật toán, ý tưởng triển khai và tri thức ngành được trình bày trên website được bảo hộ theo quy định pháp luật hiện hành.",
    ],
    items: [
      "Bạn được phép truy cập, đọc, in, tải xuống hoặc chia sẻ đường dẫn nội dung trên website cho mục đích cá nhân, nội bộ doanh nghiệp hoặc tham khảo phi thương mại, với điều kiện không làm sai lệch nội dung và ghi rõ nguồn Uptech khi trích dẫn.",
      "Bạn không được sao chép hàng loạt, tái xuất bản, chỉnh sửa, phân phối, khai thác thương mại, thiết kế ngược, gỡ bỏ thông báo bản quyền, vô hiệu hóa biện pháp bảo vệ hoặc sử dụng nội dung website theo cách gây hiểu nhầm về quan hệ với Uptech nếu chưa có chấp thuận bằng văn bản.",
      "Không có nội dung nào trên website được hiểu là cấp phép trực tiếp, gián tiếp hoặc ngụ ý cho quyền sử dụng logo, nhãn hiệu, tài sản trí tuệ, tài liệu nội bộ hoặc giải pháp của Uptech ngoài những quyền được nêu rõ trong Điều khoản này.",
      "Mọi hành vi sử dụng tài sản trí tuệ của Uptech trái phép có thể bị yêu cầu chấm dứt, gỡ bỏ, cải chính, bồi thường thiệt hại hoặc xử lý theo quy định pháp luật.",
    ],
  },
  {
    title: "Quyền và trách nhiệm của Uptech",
    paragraphs: [
      "Uptech có quyền quản lý nội dung, chức năng và hoạt động của website nhằm bảo đảm tính ổn định, an toàn và phù hợp với định hướng dịch vụ.",
    ],
    items: [
      "Uptech có quyền thay đổi, chỉnh sửa, bổ sung hoặc gỡ bỏ một phần hoặc toàn bộ nội dung, tính năng, tài nguyên trên website bất kỳ lúc nào để phục vụ vận hành, bảo trì, bảo mật, cập nhật thông tin hoặc tuân thủ pháp luật.",
      "Uptech có quyền tạm ngừng, hạn chế hoặc chấm dứt quyền truy cập website nếu phát hiện hành vi gây ảnh hưởng đến hệ thống, vi phạm Điều khoản này, xâm phạm quyền lợi hợp pháp của Uptech hoặc có dấu hiệu lạm dụng website.",
      "Uptech có quyền áp dụng các biện pháp kỹ thuật và tổ chức cần thiết để bảo vệ website trước truy cập trái phép, tấn công, sửa đổi, tiết lộ, phá hủy dữ liệu hoặc các rủi ro an ninh khác.",
      "Uptech có thể từ chối phản hồi hoặc xử lý yêu cầu nếu thông tin gửi đến không đầy đủ, không chính xác, có dấu hiệu giả mạo, spam, vi phạm pháp luật hoặc nằm ngoài phạm vi dịch vụ của chúng tôi.",
      "Uptech nỗ lực duy trì thông tin chính xác và cập nhật, nhưng không cam kết rằng mọi nội dung trên website luôn đầy đủ, không lỗi, không gián đoạn hoặc phù hợp với mọi mục đích sử dụng cụ thể.",
    ],
  },
  {
    title: "Thông tin người dùng gửi cho Uptech",
    paragraphs: [
      "Khi bạn chủ động gửi thông tin qua biểu mẫu, email, điện thoại hoặc các kênh liên hệ khác, Uptech có thể sử dụng thông tin đó để phản hồi và xử lý yêu cầu phù hợp.",
      "Thông tin cá nhân như họ tên, email, số điện thoại, tên công ty, chức danh, nhu cầu tư vấn hoặc tài liệu bạn gửi có thể được Uptech sử dụng nội bộ để phản hồi yêu cầu, tư vấn dịch vụ, chuẩn bị báo giá, cải thiện sản phẩm, nâng cao trải nghiệm website và thực hiện các nghĩa vụ hợp pháp liên quan.",
      "Uptech không chủ động bán thông tin cá nhân của người dùng. Việc chia sẻ thông tin với bên thứ ba chỉ được thực hiện khi cần thiết để vận hành hệ thống, xử lý yêu cầu, phối hợp với nhà cung cấp/đối tác liên quan, tuân thủ pháp luật hoặc khi có yêu cầu hợp lệ từ cơ quan có thẩm quyền.",
      "Không có phương thức truyền dữ liệu nào qua internet có thể được bảo đảm an toàn tuyệt đối. Uptech áp dụng các biện pháp bảo vệ hợp lý trong phạm vi kiểm soát của mình, nhưng không thể cam kết loại bỏ toàn bộ rủi ro truy cập trái phép hoặc sự cố ngoài khả năng kiểm soát hợp lý.",
      "Các thông tin, tài liệu không mang tính riêng tư hoặc không được đánh dấu là bảo mật khi gửi cho Uptech có thể được xem là thông tin được phép xử lý trong phạm vi phù hợp với mục đích bạn đã cung cấp. Với tài liệu nhạy cảm, dữ liệu khách hàng hoặc bí mật kinh doanh, hai bên nên thống nhất thỏa thuận bảo mật riêng trước khi chia sẻ.",
    ],
  },
  {
    title: "Quyền và trách nhiệm của người sử dụng",
    paragraphs: [
      "Người sử dụng có quyền truy cập website và sử dụng tài nguyên công khai của Uptech trong phạm vi hợp pháp, hợp lý và phù hợp với Điều khoản này.",
    ],
    items: [
      "Bạn có quyền truy cập website, đọc thông tin, tìm hiểu dịch vụ, gửi yêu cầu tư vấn, đăng ký nhận thông tin, ứng tuyển hoặc liên hệ Uptech qua các kênh công khai.",
      "Bạn được phép trích dẫn, chia sẻ hoặc chuyển tiếp nội dung website cho mục đích tham khảo cá nhân hoặc nội bộ doanh nghiệp, với điều kiện không làm sai lệch nội dung, không sử dụng cho mục đích thương mại trái phép và ghi nhận nguồn Uptech khi phù hợp.",
      "Bạn có trách nhiệm tuân thủ pháp luật hiện hành, tôn trọng quyền sở hữu trí tuệ, quyền riêng tư, quyền lợi hợp pháp của Uptech, người dùng khác và bên thứ ba khi sử dụng website.",
      "Bạn cam kết không can thiệp, gây gián đoạn, khai thác lỗ hổng, dò quét hệ thống, làm quá tải máy chủ, vượt quyền truy cập hoặc sử dụng công cụ tự động theo cách ảnh hưởng đến hoạt động bình thường của website.",
      "Bạn chịu trách nhiệm về tính chính xác, hợp pháp và quyền sử dụng đối với thông tin, tài liệu, dữ liệu hoặc nội dung do bạn gửi cho Uptech.",
      "Nếu bạn không hài lòng với nội dung website hoặc không đồng ý với Điều khoản này, biện pháp phù hợp là ngừng truy cập, ngừng sử dụng website hoặc liên hệ Uptech để được làm rõ.",
      "Bạn không được đăng tải, gửi, chuyển tiếp hoặc nhân bản thông tin có nội dung đe dọa, xúc phạm, phỉ báng, tục tĩu, sai lệch, gây hiểu nhầm, chứa mã độc, quảng cáo trái phép, vi phạm quyền sở hữu trí tuệ, vi phạm quyền riêng tư hoặc vi phạm pháp luật.",
    ],
  },
  {
    title: "Hạn chế sử dụng",
    paragraphs: [
      "Uptech không chấp nhận việc sử dụng website hoặc tài nguyên trên website cho các mục đích trái phép, gây hại hoặc ảnh hưởng đến quyền lợi hợp pháp của Uptech và các bên liên quan.",
    ],
    items: [
      "Sử dụng thông tin, tài liệu, hình ảnh, mô tả dịch vụ hoặc dữ liệu của Uptech cho hoạt động kinh doanh, quảng cáo, phân phối, đào tạo lại hệ thống, xây dựng cơ sở dữ liệu thương mại hoặc mục đích thương mại khác khi chưa có chấp thuận bằng văn bản.",
      "Sử dụng robot, crawler, scraper, spider, công cụ tự động hoặc quy trình thủ công có tính hệ thống để thu thập, sao chép, lập chỉ mục, tái sử dụng hoặc khai thác tài nguyên website vượt quá phạm vi truy cập thông thường.",
      "Sử dụng thiết bị, phần mềm, mã lệnh hoặc tiến trình nhằm xâm nhập, phá hoại, làm chậm, làm gián đoạn, thay đổi, chiếm quyền, thử tải trái phép hoặc kiểm thử bảo mật khi chưa được Uptech cho phép bằng văn bản.",
      "Mạo danh Uptech, nhân sự Uptech, đối tác Uptech hoặc sử dụng nội dung website để tạo thông tin gây hiểu nhầm về năng lực, đại diện, quan hệ hợp tác, chứng nhận hoặc cam kết dịch vụ.",
      "Thực hiện bất kỳ hành vi nào mà Uptech có cơ sở hợp lý để cho rằng không phù hợp, có rủi ro pháp lý, gây ảnh hưởng đến hệ thống, thương hiệu, khách hàng, đối tác hoặc người dùng khác.",
    ],
  },
  {
    title: "Biểu mẫu, yêu cầu tư vấn và báo giá",
    paragraphs: [
      "Khi bạn gửi yêu cầu qua website, Uptech có thể liên hệ lại để làm rõ nhu cầu, đề xuất hướng tiếp cận, chuẩn bị báo giá sơ bộ hoặc sắp xếp buổi trao đổi. Việc gửi biểu mẫu không đồng nghĩa hai bên đã hình thành hợp đồng dịch vụ.",
      "Các thông tin trên website về dịch vụ, giải pháp, công nghệ, tiến độ, phạm vi hỗ trợ, chi phí tham khảo hoặc kết quả kỳ vọng chỉ mang tính giới thiệu. Cam kết cụ thể chỉ có hiệu lực khi được thể hiện trong đề xuất, hợp đồng, phụ lục hoặc thỏa thuận riêng được các bên xác nhận.",
      "Uptech có thể lưu lại lịch sử yêu cầu, trạng thái phản hồi và thông tin liên quan để phục vụ chăm sóc khách hàng, quản trị nội bộ, cải thiện dịch vụ và đáp ứng nghĩa vụ pháp lý phù hợp.",
    ],
  },
  {
    title: "Loại trừ trách nhiệm",
    paragraphs: [
      "Khi sử dụng website, bạn hiểu và chấp nhận rằng một số rủi ro kỹ thuật, nội dung và kết nối có thể phát sinh ngoài khả năng kiểm soát hợp lý của Uptech.",
    ],
    items: [
      "Nội dung trên website được cung cấp cho mục đích tham khảo, truyền thông và giới thiệu năng lực. Uptech nỗ lực bảo đảm tính chính xác, nhưng không bảo đảm mọi thông tin luôn đầy đủ, cập nhật, không lỗi hoặc phù hợp với mọi mục đích sử dụng cụ thể.",
      "Bạn tự chịu trách nhiệm khi dựa vào thông tin trên website để ra quyết định kinh doanh, kỹ thuật, đầu tư, pháp lý, tài chính hoặc vận hành nếu chưa có tư vấn, đánh giá hoặc thỏa thuận riêng với Uptech.",
      "Website có thể bị gián đoạn, chậm trễ, lỗi hiển thị, lỗi đường truyền, lỗi thiết bị, rủi ro bảo mật hoặc sự cố do nhà cung cấp hạ tầng, trình duyệt, mạng internet, nền tảng bên thứ ba hoặc nguyên nhân bất khả kháng.",
      "Website có thể chứa liên kết đến mạng xã hội, nền tảng tuyển dụng, đối tác, nhà cung cấp hạ tầng, công cụ đo lường hoặc website bên thứ ba. Uptech không chịu trách nhiệm về nội dung, tính khả dụng, độ chính xác, sản phẩm, dịch vụ hoặc cách xử lý dữ liệu của các nền tảng đó.",
      "Trong phạm vi pháp luật cho phép, Uptech không chịu trách nhiệm cho thiệt hại phát sinh từ việc sử dụng sai mục đích, truy cập trái phép, phụ thuộc tuyệt đối vào nội dung tham khảo, tải xuống tài nguyên, truy cập liên kết bên ngoài hoặc sự cố nằm ngoài kiểm soát hợp lý của Uptech.",
    ],
  },
  {
    title: "Cập nhật điều khoản",
    paragraphs: [
      "Uptech có thể cập nhật điều khoản sử dụng để phản ánh thay đổi về website, dịch vụ, quy trình vận hành hoặc yêu cầu pháp lý. Phiên bản mới có hiệu lực khi được đăng tải trên website, trừ khi có thông báo khác.",
      "Bạn nên kiểm tra trang này định kỳ nếu thường xuyên sử dụng website, biểu mẫu trực tuyến hoặc nội dung chuyên môn của Uptech. Việc tiếp tục sử dụng website sau khi điều khoản được cập nhật được hiểu là bạn chấp nhận phiên bản mới.",
    ],
  },
  {
    title: "Liên hệ",
    paragraphs: [
      "Nếu có câu hỏi về điều khoản sử dụng, vui lòng liên hệ Công ty TNHH Giải Pháp Công Nghệ Uptech qua email info [at] uptech [dot] vn hoặc số điện thoại +(84) 968 726 135.",
      "Địa chỉ liên hệ: Tầng 2, B2 đường Nguyễn Hữu Thọ, Phường Tân Hưng, TP. Hồ Chí Minh.",
      "Nếu bạn cần làm rõ nội dung trên trang này, vui lòng liên hệ Uptech qua email hoặc +(84) 968 726 135.",
    ],
  },
];

function TermsSection({ section }: { readonly section: TermsSection }) {
  return (
    <section className="border-t border-[var(--border-subtle)] pt-8 sm:pt-10">
      <h2 className="text-balance text-2xl font-semibold tracking-[-0.025em] text-[var(--text-primary)] sm:text-3xl">
        {section.title}
      </h2>
      {section.paragraphs?.map((paragraph) => (
        <p
          key={paragraph}
          className="mt-4 text-pretty text-sm leading-7 text-[var(--text-secondary)] sm:text-base sm:leading-8"
        >
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

export default function TermsOfUsePage() {
  return (
    <div className="min-h-dvh bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <PublicNav />
      <main id="main-content" className="px-4 pb-20 pt-32 sm:px-6 sm:pb-28 sm:pt-40 lg:px-8">
        <article className="mx-auto max-w-4xl">
          <header className="rounded-[2rem] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6 shadow-[var(--panel-shadow)] sm:p-10 lg:p-12">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-500">
              UPTECH KNOWLEDGE
            </p>
            <h1 className="mt-4 text-balance text-4xl font-bold tracking-[-0.045em] text-[var(--text-primary)] sm:text-5xl">
              Điều khoản sử dụng
            </h1>
            <p className="mt-5 max-w-3xl text-pretty text-base leading-8 text-[var(--text-secondary)] sm:text-lg">
              Các nguyên tắc pháp lý khi truy cập, sử dụng nội dung, gửi biểu mẫu và tương tác với website Uptech. Vui lòng đọc kỹ trước khi tiếp tục sử dụng website.
            </p>
            <dl className="mt-7 flex flex-wrap gap-x-8 gap-y-3 border-t border-[var(--border-subtle)] pt-6 text-sm text-[var(--text-muted)]">
              <div className="flex gap-2">
                <dt className="font-semibold text-[var(--text-secondary)]">Cập nhật:</dt>
                <dd>23/06/2026</dd>
              </div>
              <div className="flex gap-2">
                <dt className="font-semibold text-[var(--text-secondary)]">Hiệu lực:</dt>
                <dd>23/06/2026</dd>
              </div>
            </dl>
          </header>

          <div className="mt-10 space-y-10 rounded-[2rem] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6 shadow-[var(--panel-shadow)] sm:p-10 lg:p-12">
            {sections.map((section) => (
              <TermsSection key={section.title} section={section} />
            ))}
          </div>
        </article>
      </main>

      <footer className="border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-4xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/" aria-label="UPTECH KNOWLEDGE - Trang chủ" className="inline-flex min-h-11 items-center gap-3">
            <Logo className="h-7 w-auto" />
            <span className="border-l border-[var(--border-default)] pl-3 text-xs font-bold tracking-[0.2em] text-[var(--text-secondary)]">
              KNOWLEDGE
            </span>
          </Link>
          <Link href="/" className="inline-flex min-h-11 items-center text-sm font-medium text-blue-500 transition-colors hover:text-blue-400">
            Về trang chủ
          </Link>
        </div>
      </footer>
    </div>
  );
}
