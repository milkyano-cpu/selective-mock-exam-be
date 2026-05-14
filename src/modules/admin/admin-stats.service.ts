import type { PrismaClient } from "@prisma/client";

export interface MonthlyRegistration {
  month: string; // "2026-01", "2026-02", etc.
  male: number;
  female: number;
  unspecified: number;
}

export interface StudentGenderBreakdown {
  male: number;
  female: number;
  unspecified: number;
}

export interface SubjectQuestionCount {
  subjectId: string;
  subjectName: string;
  count: number;
}

export interface AdminDashboardStats {
  totalUsers: number;
  totalStudents: number;
  totalTutors: number;
  totalParents: number;
  studentGender: StudentGenderBreakdown;
  studentTier: { basic: number; standard: number; premium: number };
  examParticipation: { participated: number; notParticipated: number };
  monthlyRegistrations: MonthlyRegistration[];
  totalQuestions: number;
  questionsPerSubject: SubjectQuestionCount[];
  publishedQuestions: number;
  pendingQuestions: number;
  draftQuestions: number;
  totalExams: number;
  activeExams: number;
  totalSubjects: number;
  totalTopics: number;
  totalPassages: number;
  totalPracticeAssignments: number;
  recentRegistrations: number; // last 7 days
}

export async function getAdminDashboardStats(
  prisma: PrismaClient
): Promise<AdminDashboardStats> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const [
    totalUsers,
    totalStudents,
    totalTutors,
    totalParents,
    maleStudents,
    femaleStudents,
    basicStudents,
    standardStudents,
    premiumStudents,
    totalQuestions,
    publishedQuestions,
    pendingQuestions,
    draftQuestions,
    totalExams,
    activeExams,
    totalSubjects,
    totalTopics,
    totalPassages,
    totalPracticeAssignments,
    recentRegistrations,
  ] = await Promise.all([
    prisma.user.count({ where: { deletedAt: null } }),
    prisma.user.count({ where: { role: "STUDENT", deletedAt: null } }),
    prisma.user.count({ where: { role: "TUTOR", deletedAt: null } }),
    prisma.user.count({ where: { role: "PARENT", deletedAt: null } }),
    prisma.user.count({ where: { role: "STUDENT", deletedAt: null, gender: "MALE" } }),
    prisma.user.count({ where: { role: "STUDENT", deletedAt: null, gender: "FEMALE" } }),
    prisma.user.count({ where: { role: "STUDENT", deletedAt: null, tier: "BASIC" } }),
    prisma.user.count({ where: { role: "STUDENT", deletedAt: null, tier: "STANDARD" } }),
    prisma.user.count({ where: { role: "STUDENT", deletedAt: null, tier: "PREMIUM" } }),
    prisma.question.count(),
    prisma.question.count({ where: { status: "PUBLISHED" } }),
    prisma.question.count({ where: { status: "PENDING_APPROVAL" } }),
    prisma.question.count({ where: { status: "DRAFT" } }),
    prisma.exam.count(),
    prisma.exam.count({ where: { status: "PUBLISHED" } }),
    prisma.subject.count(),
    prisma.topic.count(),
    prisma.passage.count(),
    prisma.practiceSession.count(),
    prisma.user.count({ where: { deletedAt: null, createdAt: { gte: sevenDaysAgo } } }),
  ]);

  const unspecifiedStudents = totalStudents - maleStudents - femaleStudents;

  // Exam participation: count distinct students who have at least one exam session
  const studentsWithExams = await prisma.examSession.groupBy({
    by: ["studentId"],
  });
  const participatedCount = studentsWithExams.length;
  const notParticipatedCount = totalStudents - participatedCount;

  // Questions per subject
  const subjectsWithCounts = await prisma.subject.findMany({
    select: {
      id: true,
      name: true,
      _count: { select: { questions: true } },
    },
    orderBy: { name: "asc" },
  });

  const questionsPerSubject: SubjectQuestionCount[] = subjectsWithCounts.map((s) => ({
    subjectId: s.id,
    subjectName: s.name,
    count: s._count.questions,
  }));

  // Monthly student registrations (last 6 months) by gender
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
  sixMonthsAgo.setDate(1);
  sixMonthsAgo.setHours(0, 0, 0, 0);

  const recentStudents = await prisma.user.findMany({
    where: {
      role: "STUDENT",
      deletedAt: null,
      createdAt: { gte: sixMonthsAgo },
    },
    select: {
      gender: true,
      createdAt: true,
    },
  });

  const monthlyMap = new Map<string, { male: number; female: number; unspecified: number }>();
  // Initialize last 6 months
  for (let i = 0; i < 6; i++) {
    const d = new Date();
    d.setMonth(d.getMonth() - (5 - i));
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthlyMap.set(key, { male: 0, female: 0, unspecified: 0 });
  }

  for (const student of recentStudents) {
    const key = `${student.createdAt.getFullYear()}-${String(student.createdAt.getMonth() + 1).padStart(2, "0")}`;
    const entry = monthlyMap.get(key);
    if (entry) {
      if (student.gender === "MALE") entry.male++;
      else if (student.gender === "FEMALE") entry.female++;
      else entry.unspecified++;
    }
  }

  const monthlyRegistrations: MonthlyRegistration[] = Array.from(monthlyMap.entries()).map(
    ([month, counts]) => ({ month, ...counts })
  );

  return {
    totalUsers,
    totalStudents,
    totalTutors,
    totalParents,
    studentGender: {
      male: maleStudents,
      female: femaleStudents,
      unspecified: unspecifiedStudents,
    },
    studentTier: {
      basic: basicStudents,
      standard: standardStudents,
      premium: premiumStudents,
    },
    examParticipation: {
      participated: participatedCount,
      notParticipated: notParticipatedCount,
    },
    monthlyRegistrations,
    totalQuestions,
    questionsPerSubject,
    publishedQuestions,
    pendingQuestions,
    draftQuestions,
    totalExams,
    activeExams,
    totalSubjects,
    totalTopics,
    totalPassages,
    totalPracticeAssignments,
    recentRegistrations,
  };
}
