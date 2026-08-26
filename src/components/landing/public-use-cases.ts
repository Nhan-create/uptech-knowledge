import type { Locale } from "@/lib/preferences";
import type { PublicInfoSection } from "./public-info-content";

type UseCase = readonly [audience: string, title: string, situation: string, input: string, action: string, output: string];

const labels = {
  vi: ["Tình huống sử dụng thực tế", "Thấy rõ sản phẩm hỗ trợ công việc như thế nào.", "Mỗi luồng bắt đầu từ dữ liệu doanh nghiệp và kết thúc bằng đầu ra có nguồn để người dùng kiểm chứng và hành động.", "Đầu vào", "Trong phần mềm", "Kết quả"],
  en: ["Real-world use cases", "See exactly how the product supports daily work.", "Each flow starts with enterprise information and ends with a grounded output people can verify and act on.", "Input", "In the product", "Outcome"],
} as const;

const vi: Record<PublicInfoSection, readonly UseCase[]> = {
  product: [
    ["Vận hành", "Tra cứu quy trình mua sắm", "Cần biết cấp duyệt cho hợp đồng 500 triệu đồng.", "Quy trình mua sắm và ma trận thẩm quyền.", "Hỏi tự nhiên, đọc câu trả lời và mở từng citation.", "Các bước, hồ sơ cần chuẩn bị và đúng dòng nguồn để kiểm tra."],
    ["Nhân sự", "Giải đáp chính sách nội bộ", "Nhân viên hỏi về nghỉ phép, công tác hoặc phúc lợi.", "Sổ tay nhân viên, quy chế và thông báo mới nhất.", "Search nhiều cách diễn đạt và ưu tiên phiên bản hiệu lực.", "Câu trả lời kèm điều khoản, ngày hiệu lực và tài liệu gốc."],
    ["Kinh doanh", "Chuẩn bị họp khách hàng", "Account cần nắm cam kết, phạm vi và lịch sử trao đổi.", "Hợp đồng, biên bản họp và tài liệu dự án.", "Tạo brief theo chủ đề từ đúng bộ nguồn đã chọn.", "Tóm tắt có cấu trúc, điểm còn mở và bằng chứng liên quan."],
  ],
  principles: [
    ["Pháp chế", "Kiểm chứng trước khi tư vấn", "Một câu hỏi liên quan nhiều phiên bản hợp đồng.", "Hợp đồng và phụ lục trong phạm vi quyền.", "Hiển thị nguồn, phiên bản và citation cạnh kết luận.", "Phân biệt dữ kiện có bằng chứng với phần cần rà soát thêm."],
    ["Quản trị", "Giữ kín tài liệu theo phòng ban", "Mỗi vai trò phải nhận phạm vi kết quả khác nhau.", "Nhóm người dùng, workspace và quyền tài liệu.", "Kiểm tra quyền trước truy xuất, chỉ dùng nguồn được phép mở.", "Không lộ tên, nội dung hay citation ngoài phạm vi."],
    ["Lãnh đạo", "Biết khi dữ liệu chưa đủ", "Cần quyết định nhưng báo cáo thiếu số liệu mới.", "Báo cáo hiện có và câu hỏi quyết định.", "AI nêu khoảng trống thay vì suy đoán và liệt kê nguồn đã kiểm tra.", "Biết phần nào chắc chắn và cần bổ sung dữ liệu nào."],
  ],
  capabilities: [
    ["Mọi phòng ban", "Search và Chat trong một luồng", "Nhớ ý nhưng không nhớ tên tài liệu.", "Từ khóa gần đúng hoặc một câu hỏi hoàn chỉnh.", "Search ngữ nghĩa tìm nguồn; Chat tổng hợp với citation.", "Đúng tài liệu, đúng đoạn và câu trả lời sẵn sàng dùng."],
    ["Quản lý dự án", "So sánh phiên bản tài liệu", "Cần biết đề xuất mới thay đổi gì.", "Hai phiên bản trong Knowledge Space.", "Nhóm thay đổi theo chủ đề và dẫn về từng vị trí.", "Danh sách khác biệt, tác động và bằng chứng cho mỗi thay đổi."],
    ["Chuyên viên", "Tạo bản nháp từ nguồn chuẩn", "Cần email, checklist hoặc tóm tắt mà không chép lại.", "Bộ tài liệu và định dạng đầu ra đã chọn.", "AI tạo nháp chỉ từ phạm vi nguồn đang hiển thị.", "Bản nháp có cấu trúc, citation và sẵn sàng chỉnh sửa."],
  ],
  workflow: [
    ["Quản trị tri thức", "Đưa nguồn mới vào workspace", "Quy trình vừa ban hành cần sớm tìm được.", "Tệp đã duyệt, chủ sở hữu, metadata và quyền.", "Tải lên, kiểm tra quyền rồi xử lý và lập chỉ mục.", "Nguồn có trạng thái rõ và chỉ xuất hiện với người có quyền."],
    ["Nhân viên", "Đi từ câu hỏi tới hành động", "Cần hoàn thành việc chứ không chỉ đọc câu trả lời.", "Câu hỏi và workspace liên quan.", "Hỏi, kiểm tra citation, mở nguồn rồi tiếp tục xử lý.", "Đầu ra công việc có đường kiểm chứng đầy đủ."],
    ["Chủ sở hữu nội dung", "Cập nhật không mất dấu phiên bản", "Tài liệu thay đổi nhưng lịch sử cần truy vết.", "Bản mới, ngày hiệu lực và tài liệu thay thế.", "Ghi phiên bản, tái lập chỉ mục và đánh dấu nguồn hiệu lực.", "Nội dung mới nhất cùng lịch sử có thể kiểm tra."],
  ],
};

const en: Record<PublicInfoSection, readonly UseCase[]> = {
  product: [
    ["Operations", "Look up a procurement procedure", "An employee needs the approval path for a major contract.", "Procurement procedure and authority matrix.", "Ask naturally, review the answer, and open each citation.", "Approval steps, required documents, and exact source locations."],
    ["People team", "Answer internal policy questions", "Employees ask about leave, travel, or benefits.", "Handbook, policies, and latest notices.", "Search across wording and prioritize the active version.", "An answer with the governing clause, effective date, and source."],
    ["Sales", "Prepare for a customer meeting", "An account owner needs commitments and discussion history.", "Contracts, meeting notes, and project documents.", "Create a topic-based brief from the selected sources.", "A structured brief, open issues, and supporting evidence."],
  ],
  principles: [
    ["Legal", "Verify before advising", "A question spans several contract versions.", "Contracts and amendments within access scope.", "Show sources, versions, and citations beside conclusions.", "Grounded facts separated from items needing review."],
    ["Administrators", "Keep team documents private", "Different roles require different result scopes.", "User groups, workspaces, and document permissions.", "Check access before retrieval and use only openable sources.", "No names, content, or citations leak outside scope."],
    ["Leadership", "Know when evidence is incomplete", "A decision is needed but reports lack current figures.", "Available reports and the decision question.", "Identify gaps instead of guessing and list checked sources.", "Leaders see what is supported and what data is still needed."],
  ],
  capabilities: [
    ["Every team", "Search and chat in one flow", "A user recalls the meaning, not the file name.", "Approximate keywords or a complete question.", "Semantic search finds sources; chat answers with citations.", "The right document, passage, and a usable answer."],
    ["Project managers", "Compare document versions", "A manager needs to understand proposal changes.", "Two versions in a Knowledge Space.", "Group changes by topic and link each to its location.", "Differences, impact, and evidence for every change."],
    ["Specialists", "Draft from approved sources", "A specialist needs an email, checklist, or summary.", "A source set and requested output format.", "Generate only from the source scope shown on screen.", "A structured, cited draft ready for human review."],
  ],
  workflow: [
    ["Knowledge admins", "Bring a new source into a workspace", "A new procedure must become searchable quickly.", "Approved file, owner, metadata, and access scope.", "Upload, validate access, process, and index.", "Clear source status and visibility only for authorized people."],
    ["Employees", "Move from question to action", "A user needs to complete work, not just read an answer.", "A question and relevant workspace.", "Ask, verify citations, open evidence, and continue working.", "A work product with a complete verification trail."],
    ["Content owners", "Update without losing history", "Content changes while older answers remain traceable.", "New version, effective date, and superseded source.", "Record version, re-index, and mark the active source.", "Current information with auditable history."],
  ],
};

export function getPublicUseCases(section: PublicInfoSection, locale: Locale) {
  const [eyebrow, title, description, input, action, output] = labels[locale];
  return { eyebrow, title, description, input, action, output, cases: (locale === "en" ? en : vi)[section] };
}
