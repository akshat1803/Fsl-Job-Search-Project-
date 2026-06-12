const mysql = require('mysql2/promise');
require('dotenv').config();

const ddl = `
CREATE TABLE IF NOT EXISTS UserRoles (
    Id          INT PRIMARY KEY,
    RoleName    VARCHAR(50) NOT NULL,
    IsActive    BIT NOT NULL DEFAULT 1,
    CreatedBy   INT NULL,
    CreatedDate DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UpdatedBy   INT NULL,
    UpdatedDate DATETIME NULL DEFAULT NULL
);

INSERT INTO UserRoles (Id, RoleName, IsActive) VALUES
(1, 'Admin',     1),
(2, 'Candidate', 1),
(3, 'Company',   1)
ON DUPLICATE KEY UPDATE RoleName = VALUES(RoleName), IsActive = VALUES(IsActive);

CREATE TABLE IF NOT EXISTS Users (
    Id           CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
    FirstName    VARCHAR(100) NOT NULL,
    LastName     VARCHAR(100) NOT NULL,
    Email        VARCHAR(255) NOT NULL UNIQUE,
    PasswordHash VARCHAR(500) NOT NULL,
    MobileNo     VARCHAR(20),
    UserRole     INT          NOT NULL,
    Bio          TEXT,
    IsVerified   BOOLEAN      NOT NULL DEFAULT FALSE,
    CreatedAt    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CreatedBy    INT NULL,
    UpdatedAt    DATETIME NULL,
    UpdatedBy    INT NULL,
    IsActive     BOOLEAN      NOT NULL DEFAULT TRUE,

    CONSTRAINT FK_Users_UserRoles
        FOREIGN KEY (UserRole) REFERENCES UserRoles(Id)
);

CREATE TABLE IF NOT EXISTS Tokens (
    Id        CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    UserId    CHAR(36) NOT NULL,
    Token     VARCHAR(500),
    Purpose   ENUM('email_verify', 'password_reset'),
    ExpiresAt DATETIME,
    CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT FK_Tokens_Users
        FOREIGN KEY (UserId) REFERENCES Users(Id)
);

CREATE TABLE IF NOT EXISTS Candidate (
    Id              CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    UserId          CHAR(36) UNIQUE NOT NULL,
    DOB             DATE,
    Visibility      ENUM('public', 'hidden', 'private') DEFAULT 'public',
    Address         JSON,
    Skills          JSON,
    Languages       JSON,
    Education       JSON,
    Experience      JSON,
    Certifications  JSON,
    TrainingCourses JSON,
    DrivingLicenses JSON,
    DesiredJob      JSON,
    CreatedAt       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CreatedBy       CHAR(36) NULL,
    UpdatedAt       DATETIME NULL,
    UpdatedBy       CHAR(36) NULL,
    IsActive        BOOLEAN NOT NULL DEFAULT TRUE,

    CONSTRAINT FK_Candidate_Users
        FOREIGN KEY (UserId) REFERENCES Users(Id)
);

CREATE TABLE IF NOT EXISTS Media (
    Id                CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    UserId            CHAR(36) NOT NULL,
    ProfilePhotoUrl   VARCHAR(1000),
    CvUrl             VARCHAR(1000),
    CertificateUrl    VARCHAR(1000),
    VideoUrl          VARCHAR(1000),
    VideoThumbnailUrl VARCHAR(1000),
    VideoDuration     INT,
    VideoStatus       ENUM('processing', 'ready', 'rejected') DEFAULT 'ready',
    CreatedAt         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CreatedBy         CHAR(36) NULL,
    UpdatedAt         DATETIME NULL,
    UpdatedBy         CHAR(36) NULL,
    IsActive          BOOLEAN NOT NULL DEFAULT TRUE,

    CONSTRAINT FK_Media_Users
        FOREIGN KEY (UserId) REFERENCES Users(Id)
);

CREATE TABLE IF NOT EXISTS Addresses (
    Id                CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    UserId            CHAR(36) NOT NULL,
    TypeOfAddress     ENUM('permanent', 'current', 'company') NOT NULL,
    Street            VARCHAR(255),
    BuildingApartment VARCHAR(255),
    TownCity          VARCHAR(100),
    StateProvince     VARCHAR(100),
    CountryId         INT,
    IsPrimary         BOOLEAN NOT NULL DEFAULT FALSE,
    CreatedAt         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CreatedBy         CHAR(36) NULL,
    UpdatedAt         DATETIME NULL,
    UpdatedBy         CHAR(36) NULL,
    IsActive          BOOLEAN NOT NULL DEFAULT TRUE,

    CONSTRAINT FK_Addresses_Users
        FOREIGN KEY (UserId) REFERENCES Users(Id)
);

CREATE TABLE IF NOT EXISTS Companies (
    Id            CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    UserId        CHAR(36) NOT NULL,
    Name          VARCHAR(255),
    TaxId         VARCHAR(100),
    VatNo         VARCHAR(100),
    IndustryId    INT,
    Size          VARCHAR(100),
    Website       VARCHAR(500),
    Logo          VARCHAR(500),
    Description   TEXT,
    ContactPerson VARCHAR(255),
    CreatedAt     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CreatedBy     CHAR(36) NULL,
    UpdatedAt     DATETIME NULL,
    UpdatedBy     CHAR(36) NULL,
    IsActive      BOOLEAN NOT NULL DEFAULT TRUE,

    FOREIGN KEY (UserId) REFERENCES Users(Id)
);

CREATE TABLE IF NOT EXISTS JobVacancies (
    Id               CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    CompanyId        CHAR(36) NOT NULL,
    UserId           CHAR(36) NOT NULL,
    Title            VARCHAR(255),
    Description      TEXT,
    EmploymentTypeId INT,
    Salary           DECIMAL(18,2),
    Currency         VARCHAR(10),
    CountryId        INT,
    WorkplaceTypeId  INT,
    RequiredSkills   JSON,
    Status           ENUM('open', 'closed') DEFAULT 'open',
    Deadline         DATE,
    CreatedAt        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CreatedBy        CHAR(36) NULL,
    UpdatedAt        DATETIME NULL,
    UpdatedBy        CHAR(36) NULL,
    IsActive         BOOLEAN NOT NULL DEFAULT TRUE,

    FOREIGN KEY (CompanyId) REFERENCES Companies(Id),
    FOREIGN KEY (UserId)    REFERENCES Users(Id)
);

CREATE TABLE IF NOT EXISTS Applications (
    Id          CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    UserId      CHAR(36) NOT NULL,
    CandidateId CHAR(36) NOT NULL,
    VacancyId   CHAR(36) NOT NULL,
    CompanyId   CHAR(36) NOT NULL,
    Status      ENUM('applied','shortlisted','contacted','hired','rejected') DEFAULT 'applied',
    CreatedAt   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CreatedBy   CHAR(36) NULL,
    UpdatedAt   DATETIME NULL,
    UpdatedBy   CHAR(36) NULL,
    IsActive    BOOLEAN NOT NULL DEFAULT TRUE,

    FOREIGN KEY (UserId)      REFERENCES Users(Id),
    FOREIGN KEY (CandidateId) REFERENCES Candidate(Id),
    FOREIGN KEY (CompanyId)   REFERENCES Companies(Id),
    FOREIGN KEY (VacancyId)   REFERENCES JobVacancies(Id)
);

CREATE TABLE IF NOT EXISTS Shortlists (
    Id          CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    UserId      CHAR(36) NOT NULL,
    CandidateId CHAR(36) NOT NULL,
    CompanyId   CHAR(36) NOT NULL,
    CreatedAt   DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (UserId)      REFERENCES Users(Id),
    FOREIGN KEY (CandidateId) REFERENCES Candidate(Id),
    FOREIGN KEY (CompanyId)   REFERENCES Companies(Id)
);

CREATE TABLE IF NOT EXISTS Messages (
    Id         CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    SenderId   CHAR(36) NOT NULL,
    ReceiverId CHAR(36) NOT NULL,
    Body       TEXT NOT NULL,
    IsRead     BOOLEAN NOT NULL DEFAULT FALSE,
    CreatedAt  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CreatedBy  CHAR(36) NULL,
    UpdatedAt  DATETIME NULL,
    UpdatedBy  CHAR(36) NULL,
    IsActive   BOOLEAN NOT NULL DEFAULT TRUE,

    FOREIGN KEY (SenderId)   REFERENCES Users(Id),
    FOREIGN KEY (ReceiverId) REFERENCES Users(Id)
);
`;

const seedData = `
DELETE FROM Messages;
DELETE FROM Shortlists;
DELETE FROM Applications;
DELETE FROM JobVacancies;
DELETE FROM Companies;
DELETE FROM Media;
DELETE FROM Candidate;
DELETE FROM Addresses;
DELETE FROM Tokens;
DELETE FROM Users;

INSERT INTO Users (
    Id, FirstName, LastName, Email, PasswordHash,
    MobileNo, UserRole, Bio, IsVerified, CreatedAt, IsActive
)
VALUES
('11111111-1111-1111-1111-111111111111', 'Anant',   'Sharma',      'anant.sharma@example.com',       '$2a$10$3TnrcLN/VxO1N3kNtKus0uVQBo24frVJEoMOTLMJr.nwexvTd834u', '9876543210', 2, 'Full Stack Developer',           TRUE,  NOW(), TRUE),
('22222222-2222-2222-2222-222222222222', 'Rahul',   'Verma',       'rahul.verma@example.com',        '$2a$10$3TnrcLN/VxO1N3kNtKus0uVQBo24frVJEoMOTLMJr.nwexvTd834u', '9876543211', 2, 'React Developer',                TRUE,  NOW(), TRUE),
('33333333-3333-3333-3333-333333333333', 'Priya',   'Singh',       'priya.singh@example.com',        '$2a$10$3TnrcLN/VxO1N3kNtKus0uVQBo24frVJEoMOTLMJr.nwexvTd834u', '9876543212', 2, 'UI/UX Designer',                 FALSE, NOW(), TRUE),
('44444444-4444-4444-4444-444444444444', 'Amit',    'Kumar',       'amit.kumar@example.com',         '$2a$10$3TnrcLN/VxO1N3kNtKus0uVQBo24frVJEoMOTLMJr.nwexvTd834u', '9876543213', 2, 'Node.js Developer',              TRUE,  NOW(), TRUE),
('55555555-5555-5555-5555-555555555555', 'Neha',    'Gupta',       'neha.gupta@example.com',         '$2a$10$3TnrcLN/VxO1N3kNtKus0uVQBo24frVJEoMOTLMJr.nwexvTd834u', '9876543214', 2, 'QA Engineer',                    TRUE,  NOW(), TRUE),

('66666666-6666-6666-6666-666666666666', 'Tech',    'Solutions',   'hr@techsolutions.com',           '$2a$10$3TnrcLN/VxO1N3kNtKus0uVQBo24frVJEoMOTLMJr.nwexvTd834u', '9000000001', 3, 'Software Development Company',   TRUE,  NOW(), TRUE),
('77777777-7777-7777-7777-777777777777', 'Digital', 'Innovations', 'careers@digitalinnovations.com', '$2a$10$3TnrcLN/VxO1N3kNtKus0uVQBo24frVJEoMOTLMJr.nwexvTd834u', '9000000002', 3, 'IT Consulting Firm',             TRUE,  NOW(), TRUE),
('88888888-8888-8888-8888-888888888888', 'Cloud',   'Systems',     'jobs@cloudsystems.com',          '$2a$10$3TnrcLN/VxO1N3kNtKus0uVQBo24frVJEoMOTLMJr.nwexvTd834u', '9000000003', 3, 'Cloud Infrastructure Provider',  TRUE,  NOW(), TRUE),
('99999999-9999-9999-9999-999999999999', 'NextGen', 'Technologies','hr@nextgentech.com',             '$2a$10$3TnrcLN/VxO1N3kNtKus0uVQBo24frVJEoMOTLMJr.nwexvTd834u', '9000000004', 3, 'AI & ML Solutions',              TRUE,  NOW(), TRUE),
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Future',  'Softwares',   'recruitment@futuresoft.com',     '$2a$10$3TnrcLN/VxO1N3kNtKus0uVQBo24frVJEoMOTLMJr.nwexvTd834u', '9000000005', 3, 'Enterprise Software Company',    TRUE,  NOW(), TRUE);

SET @anant_id  = '11111111-1111-1111-1111-111111111111';
SET @rahul_id  = '22222222-2222-2222-2222-222222222222';
SET @priya_id  = '33333333-3333-3333-3333-333333333333';
SET @amit_id   = '44444444-4444-4444-4444-444444444444';
SET @neha_id   = '55555555-5555-5555-5555-555555555555';

SET @tech_user_id    = '66666666-6666-6666-6666-666666666666';
SET @digital_user_id = '77777777-7777-7777-7777-777777777777';
SET @cloud_user_id   = '88888888-8888-8888-8888-888888888888';
SET @nextgen_user_id = '99999999-9999-9999-9999-999999999999';
SET @future_user_id  = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

INSERT INTO Candidate (
    Id, UserId, DOB, Visibility,
    Skills, Languages, Address,
    Education, Experience, Certifications,
    TrainingCourses, DrivingLicenses, DesiredJob,
    CreatedAt, IsActive
) VALUES (
    '11111111-1111-1111-1111-111111111112',
    @anant_id,
    '1998-05-12',
    'public',
    '[{"skill":"React","level":"Advanced"},{"skill":"Node.js","level":"Intermediate"},{"skill":"TypeScript","level":"Advanced"}]',
    '[{"language":"English","level":"Fluent"},{"language":"Hindi","level":"Native"}]',
    '{"street":"123 Main Street","city":"Jaipur","state":"Rajasthan","country":"India","postalCode":"302001"}',
    '[{"degree":"B.Tech","specialization":"Computer Science","institution":"RTU","startDate":"2016-08-01","endDate":"2020-06-30"}]',
    '[{"jobTitle":"Software Engineer","company":"TCS","industry":"IT","startDate":"2021-01-01","endDate":"2023-12-31","currentlyWorking":false},{"jobTitle":"Senior Developer","company":"Infosys","industry":"IT","startDate":"2024-01-01","currentlyWorking":true}]',
    '[{"title":"AWS Certified Developer","institution":"Amazon","issuedOn":"2023-05-10"}]',
    '[{"name":"Docker & Kubernetes","heldBy":"Udemy","startDate":"2023-01-01","endDate":"2023-02-01"}]',
    '[{"category":"LMV","country":"India","dateObtained":"2018-06-15"}]',
    '{"jobTitle":"Full Stack Developer","employmentType":"Full Time","desiredSalary":1200000,"currency":"INR","workplaceType":"Remote","yearsExperience":4,"minimumContract":"12 Months","requestedBenefits":["Health Insurance","WFH"],"preferredLocations":["India","UAE","Germany"]}',
    NOW(), TRUE
);

INSERT INTO Candidate (Id, UserId, DOB, Visibility, Skills, Languages, Address, Education, Experience, CreatedAt, IsActive) VALUES (
    '22222222-2222-2222-2222-222222222223',
    @rahul_id,
    '1997-09-25',
    'public',
    '[{"skill":"React","level":"Advanced"},{"skill":"Redux","level":"Advanced"},{"skill":"JavaScript","level":"Expert"}]',
    '[{"language":"English","level":"Fluent"},{"language":"Hindi","level":"Native"}]',
    '{"street":"45 Park Street","city":"Delhi","state":"Delhi","country":"India","postalCode":"110001"}',
    '[{"degree":"B.Sc","specialization":"IT","institution":"Delhi University","startDate":"2015-08-01","endDate":"2018-06-30"}]',
    '[{"jobTitle":"Frontend Developer","company":"Wipro","industry":"IT","startDate":"2018-07-01","endDate":"2022-06-30","currentlyWorking":false},{"jobTitle":"React Developer","company":"Razorpay","industry":"Fintech","startDate":"2022-07-01","currentlyWorking":true}]',
    NOW(), TRUE
);

INSERT INTO Candidate (Id, UserId, DOB, Visibility, Skills, Languages, Address, Education, Experience, CreatedAt, IsActive) VALUES (
    '33333333-3333-3333-3333-333333333334',
    @priya_id,
    '1999-03-18',
    'hidden',
    '[{"skill":"Figma","level":"Expert"},{"skill":"Adobe XD","level":"Advanced"},{"skill":"UI Design","level":"Advanced"}]',
    '[{"language":"English","level":"Fluent"},{"language":"Hindi","level":"Native"}]',
    '{"street":"78 MG Road","city":"Bangalore","state":"Karnataka","country":"India","postalCode":"560001"}',
    '[{"degree":"B.Des","specialization":"Interaction Design","institution":"NID Ahmedabad","startDate":"2017-08-01","endDate":"2021-06-30"}]',
    '[{"jobTitle":"UI Designer","company":"Zomato","industry":"Food Tech","startDate":"2021-08-01","currentlyWorking":true}]',
    NOW(), TRUE
);

INSERT INTO Candidate (Id, UserId, DOB, Visibility, Skills, Languages, Address, Education, Experience, CreatedAt, IsActive) VALUES (
    '44444444-4444-4444-4444-444444444445',
    @amit_id,
    '1996-11-08',
    'public',
    '[{"skill":"Node.js","level":"Expert"},{"skill":"Express","level":"Advanced"},{"skill":"MongoDB","level":"Advanced"}]',
    '[{"language":"English","level":"Professional"},{"language":"Hindi","level":"Native"}]',
    '{"street":"22 Linking Road","city":"Mumbai","state":"Maharashtra","country":"India","postalCode":"400050"}',
    '[{"degree":"MCA","specialization":"Software Engineering","institution":"Pune University","startDate":"2014-08-01","endDate":"2017-06-30"}]',
    '[{"jobTitle":"Backend Developer","company":"Zoho","industry":"SaaS","startDate":"2017-07-01","endDate":"2023-06-30","currentlyWorking":false},{"jobTitle":"Senior Backend Dev","company":"Swiggy","industry":"Food Tech","startDate":"2023-07-01","currentlyWorking":true}]',
    NOW(), TRUE
);

INSERT INTO Candidate (Id, UserId, DOB, Visibility, Skills, Languages, Address, Education, Experience, CreatedAt, IsActive) VALUES (
    '55555555-5555-5555-5555-555555555556',
    @neha_id,
    '1998-07-30',
    'public',
    '[{"skill":"Manual Testing","level":"Expert"},{"skill":"Selenium","level":"Advanced"},{"skill":"Cypress","level":"Intermediate"}]',
    '[{"language":"English","level":"Fluent"},{"language":"Hindi","level":"Native"}]',
    '{"street":"56 Civil Lines","city":"Jaipur","state":"Rajasthan","country":"India","postalCode":"302006"}',
    '[{"degree":"B.Tech","specialization":"Computer Science","institution":"MNIT Jaipur","startDate":"2016-08-01","endDate":"2020-06-30"}]',
    '[{"jobTitle":"QA Engineer","company":"HCL","industry":"IT","startDate":"2020-07-01","currentlyWorking":true}]',
    NOW(), TRUE
);

INSERT INTO Media (Id, UserId, ProfilePhotoUrl, CvUrl, CertificateUrl, VideoUrl, VideoThumbnailUrl, VideoDuration, VideoStatus) VALUES
('11111111-1111-1111-1111-111111111113', @anant_id, 'https://cdn.site.com/anant_photo.jpg', 'https://cdn.site.com/anant_cv.pdf', 'https://cdn.site.com/anant_aws_cert.pdf', 'https://cdn.site.com/anant_video.mp4', 'https://cdn.site.com/anant_thumb.jpg', 120, 'ready'),
('22222222-2222-2222-2222-222222222224', @rahul_id, 'https://cdn.site.com/rahul_photo.jpg', 'https://cdn.site.com/rahul_cv.pdf', NULL, NULL, NULL, NULL, 'ready'),
('33333333-3333-3333-3333-333333333335', @priya_id, 'https://cdn.site.com/priya_photo.jpg', 'https://cdn.site.com/priya_cv.pdf', 'https://cdn.site.com/priya_design_cert.pdf', NULL, NULL, NULL, 'ready'),
('44444444-4444-4444-4444-444444444446', @amit_id,  'https://cdn.site.com/amit_photo.jpg',  'https://cdn.site.com/amit_cv.pdf',  NULL, 'https://cdn.site.com/amit_video.mp4', 'https://cdn.site.com/amit_thumb.jpg', 90, 'ready'),
('55555555-5555-5555-5555-555555555557', @neha_id,  'https://cdn.site.com/neha_photo.jpg',  'https://cdn.site.com/neha_cv.pdf',  NULL, NULL, NULL, NULL, 'ready');

INSERT INTO Companies (Id, UserId, Name, IndustryId, Size, Website, Logo, Description, ContactPerson, CreatedAt, IsActive) VALUES
('66666666-6666-6666-6666-666666666667', @tech_user_id,    'Tech Solutions',    1, '51-200',   'https://techsolutions.com',    'https://techsolutions.com/logo.png', 'Software Development Company',   'Sunita Agarwal', NOW(), TRUE),
('77777777-7777-7777-7777-777777777778', @digital_user_id, 'Digital Innovations',1, '201-500', 'https://digitalinnovations.com','https://digitalinnovations.com/logo.png','IT Consulting Firm',            'Rajesh Kapoor',  NOW(), TRUE),
('88888888-8888-8888-8888-888888888889', @cloud_user_id,   'Cloud Systems',     2, '51-200',   'https://cloudsystems.com',     'https://cloudsystems.com/logo.png',     'Cloud Infrastructure Provider',  'Meena Sharma',   NOW(), TRUE),
('99999999-9999-9999-9999-99999999999a', @nextgen_user_id, 'NextGen Technologies',1,'501-1000','https://nextgentech.com',      'https://nextgentech.com/logo.png',      'AI & ML Solutions',              'Vikas Mehta',    NOW(), TRUE),
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaab', @future_user_id,  'Future Softwares',  1, '11-50',    'https://futuresoft.com',       'https://futuresoft.com/logo.png',       'Enterprise Software Company',    'Pooja Singh',    NOW(), TRUE);

SET @tech_co_id    = '66666666-6666-6666-6666-666666666667';
SET @digital_co_id = '77777777-7777-7777-7777-777777777778';
SET @cloud_co_id   = '88888888-8888-8888-8888-888888888889';

INSERT INTO JobVacancies (Id, CompanyId, UserId, Title, Description, Salary, Currency, CountryId, RequiredSkills, Status, Deadline, CreatedAt, IsActive) VALUES
('11111111-1111-1111-1111-111111111114', @tech_co_id, @tech_user_id, 'Senior React Developer', 'React.js mein 3+ saal experience.', 120000, 'INR', 1, '["React","Redux","TypeScript"]', 'open', '2025-09-30', NOW(), TRUE),
('22222222-2222-2222-2222-222222222225', @tech_co_id, @tech_user_id, 'Node.js Backend Developer', 'Node.js aur Express REST APIs.', 100000, 'INR', 1, '["Node.js","Express","MongoDB"]', 'open', '2025-08-31', NOW(), TRUE),
('33333333-3333-3333-3333-333333333336', @digital_co_id, @digital_user_id, 'UI/UX Designer', 'Figma aur Adobe XD expert chahiye.', 90000, 'INR', 1, '["Figma","Adobe XD","UI Design"]', 'open', '2025-09-15', NOW(), TRUE),
('44444444-4444-4444-4444-444444444447', @cloud_co_id, @cloud_user_id, 'DevOps Engineer', 'AWS aur Docker experience zaroori.', 150000, 'INR', 1, '["AWS","Docker","Kubernetes"]', 'open', '2025-10-01', NOW(), TRUE),
('55555555-5555-5555-5555-555555555558', @digital_co_id, @digital_user_id, 'QA Automation Engineer', 'Selenium ya Cypress experience.', 80000, 'INR', 1, '["Selenium","Cypress","Manual Testing"]', 'open', '2025-08-15', NOW(), TRUE);

SET @anant_cand_id = '11111111-1111-1111-1111-111111111112';
SET @rahul_cand_id = '22222222-2222-2222-2222-222222222223';
SET @priya_cand_id = '33333333-3333-3333-3333-333333333334';
SET @amit_cand_id  = '44444444-4444-4444-4444-444444444445';
SET @neha_cand_id  = '55555555-5555-5555-5555-555555555556';

SET @job1_id = '11111111-1111-1111-1111-111111111114';
SET @job2_id = '22222222-2222-2222-2222-222222222225';
SET @job3_id = '33333333-3333-3333-3333-333333333336';
SET @job4_id = '44444444-4444-4444-4444-444444444447';
SET @job5_id = '55555555-5555-5555-5555-555555555558';

INSERT INTO Applications (Id, UserId, CandidateId, VacancyId, CompanyId, Status, CreatedAt, IsActive) VALUES
('11111111-1111-1111-1111-111111111115', @anant_id, @anant_cand_id, @job1_id, @tech_co_id,    'shortlisted', NOW(), TRUE),
('22222222-2222-2222-2222-222222222226', @rahul_id, @rahul_cand_id, @job1_id, @tech_co_id,    'applied',     NOW(), TRUE),
('33333333-3333-3333-3333-333333333337', @amit_id,  @amit_cand_id,  @job2_id, @tech_co_id,    'contacted',   NOW(), TRUE),
('44444444-4444-4444-4444-444444444448', @priya_id, @priya_cand_id, @job3_id, @digital_co_id, 'applied',     NOW(), TRUE),
('55555555-5555-5555-5555-555555555559', @neha_id,  @neha_cand_id,  @job5_id, @digital_co_id, 'hired',       NOW(), TRUE);

INSERT INTO Messages (Id, SenderId, ReceiverId, Body, IsRead, CreatedAt, IsActive) VALUES
('11111111-1111-1111-1111-111111111116', @tech_user_id,    @anant_id,    'Namaste Anant ji, kya aap kal interview ke liye available hain?', TRUE,  NOW(), TRUE),
('22222222-2222-2222-2222-222222222227', @anant_id,        @tech_user_id,'Haan bilkul, main kal 10 baje available hoon.',                   TRUE,  NOW(), TRUE),
('33333333-3333-3333-3333-333333333338', @tech_user_id,    @anant_id,    'Bahut achha, Google Meet link email karenge.',                     FALSE, NOW(), TRUE),
('44444444-4444-4444-4444-444444444449', @digital_user_id, @priya_id,    'Priya ji, aapka portfolio dekha, bahut impressive hai.',           TRUE,  NOW(), TRUE),
('55555555-5555-5555-5555-55555555555a', @priya_id,        @digital_user_id,'Shukriya! Main interested hoon.',                              FALSE, NOW(), TRUE);

INSERT INTO Shortlists (Id, UserId, CandidateId, CompanyId, CreatedAt) VALUES
('11111111-1111-1111-1111-111111111117', @tech_user_id,    @anant_cand_id, @tech_co_id,    NOW()),
('22222222-2222-2222-2222-222222222228', @digital_user_id, @priya_cand_id, @digital_co_id, NOW()),
('33333333-3333-3333-3333-333333333339', @tech_user_id,    @amit_cand_id,  @tech_co_id,    NOW());
`;

async function main() {
  const host = process.env.DB_HOST || '127.0.0.1';
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASSWORD || 'Jatin@0524';

  console.log(`Connecting to MySQL at ${host} as ${user}...`);
  const conn = await mysql.createConnection({
    host,
    user,
    password,
    multipleStatements: true
  });

  try {
    console.log('Creating database jobsearch if not exists...');
    await conn.query('CREATE DATABASE IF NOT EXISTS jobsearch;');
    await conn.query('USE jobsearch;');

    console.log('Running DDL queries to create tables...');
    await conn.query(ddl);

    console.log('Seeding table data...');
    await conn.query(seedData);

    console.log('Database initialized successfully!');
  } catch (err) {
    console.error('Database initialization failed:', err.message || err);
    if (err.sqlMessage) console.error('SQL Error:', err.sqlMessage);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

main();
