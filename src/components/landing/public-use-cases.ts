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
    ["Mọi phòng ban", "Tìm kiếm và Trợ lý AI trong một luồng", "Nhớ nội dung chính sách nhưng không nhớ tên tài liệu.", "Từ khóa hoặc câu hỏi trong phạm vi Không gian tri thức.", "Lọc nguồn Sẵn sàng trên Tìm kiếm rồi hỏi Trợ lý AI kèm trích dẫn [1]..[N].", "Đúng tài liệu Sẵn sàng, đoạn trích gốc và câu trả lời kiểm chứng được."],
    ["Quản lý dự án", "So sánh tài liệu (Diff)", "Cần biết tài liệu mới bổ sung hoặc thay đổi điểm nào.", "Hai tài liệu Sẵn sàng trong Thư viện.", "Mở So sánh Diff để đối chiếu các mục Bổ sung và Thay đổi.", "Danh sách điểm bổ sung, thay đổi và ngữ cảnh đối chiếu rõ ràng."],
    ["Chuyên viên", "Tạo bản nháp từ Tiện ích AI", "Cần tóm tắt, dịch thuật, checklist, báo cáo hoặc email từ tài liệu gốc.", "Tác vụ đã chọn và 1–3 nguồn trong Tiện ích AI.", "Chạy tác vụ trên bộ nguồn đã chọn và rà soát bản nháp ngay trên màn hình.", "Bản nháp có ghi rõ nguồn đầu vào để kiểm tra trước khi sử dụng."],
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
    ["Every team", "Search and AI Assistant in one flow", "A user recalls the policy topic, not the file name.", "Keywords or a question scoped to a Knowledge Space.", "Filter Ready files in Search, then ask AI Assistant with [1]..[N] citations.", "The right Ready document, source excerpt, and a verifiable answer."],
    ["Project managers", "Compare documents with Diff", "A manager needs to see what changed between documents.", "Two Ready documents from the Library.", "Open Document Diff to review Additions and Changes side by side.", "Clear list of additions, changes, and comparison context."],
    ["Specialists", "Draft outputs in AI Utilities", "A specialist needs a summary, translation, checklist, report, or email.", "Chosen utility and 1–3 selected sources.", "Run the utility on selected sources and review the editable draft.", "A source-labeled draft ready for human verification."],
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
