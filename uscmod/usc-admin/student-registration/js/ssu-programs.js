export const SSU_PROGRAMS = Object.freeze({
  "College of Education": [
    "Bachelor of Elementary Education",
    "Bachelor of Secondary Education major in English",
    "Bachelor of Secondary Education major in Mathematics",
    "Bachelor of Secondary Education major in Science",
    "Bachelor of Secondary Education major in Social Studies",
    "Bachelor of Physical Education",
    "Bachelor of Early Childhood Education"
  ],
  "College of Arts and Sciences": [
    "Bachelor of Information System",
    "Bachelor of Information Technology",
    "Bachelor of Science in Psychology",
    "Bachelor of Science in Statistics"
  ],
  "College of Nursing and Health Sciences": [
    "Bachelor of Science in Nursing",
    "Bachelor of Science in Nutrition and Dietetics",
    "Bachelor of Science in Pharmacy"
  ],
  "College of Engineering": [
    "Bachelor of Science in Civil Engineering",
    "Bachelor of Science in Electrical Engineering",
    "Bachelor of Science in Computer Engineering",
    "Bachelor of Science in Electronics Engineering"
  ],
  "College of Industrial Technology": [
    "Bachelor of Industrial Technology major in Automotive Technology",
    "Bachelor of Industrial Technology major in Culinary Technology",
    "Bachelor of Industrial Technology major in Electrical Technology",
    "Bachelor of Industrial Technology major in Electronics Technology",
    "Bachelor of Industrial Technology major in Architectural Drafting Technology",
    "Bachelor of Industrial Technology major in Mechanical Technology",
    "Bachelor of Industrial Technology major in Heating, Ventilating Air-Conditioning and Refrigeration Technology",
    "Bachelor of Industrial Technology major in Beauty Care and Wellness Technology",
    "Bachelor of Industrial Technology major in Apparel and Fashion Technology",
    "Bachelor of Science in Architecture"
  ],
  "SSU Mercedes Campus": [
    "Bachelor of Science in Fisheries",
    "Bachelor of Science in Marine Biology",
    "Bachelor of Technical Vocational Teacher Education major in Aquaculture",
    "Bachelor of Technical Vocational Teacher Education major in Fish Processing",
    "Bachelor of Technical Vocational Teacher Education major in Fish Capture"
  ],
  "SSU Paranas Campus": [
    "Bachelor of Secondary Education major in Filipino",
    "Bachelor of Secondary Education major in Mathematics",
    "Bachelor of Elementary Education",
    "Bachelor of Industrial Technology major in Automotive Technology",
    "Bachelor of Industrial Technology major in Architectural Drafting Technology",
    "Bachelor of Industrial Technology major in Apparel and Fashion Technology",
    "Bachelor of Industrial Technology major in Electrical Technology",
    "Bachelor of Industrial Technology major in Culinary Technology"
  ]
});

export function isValidSsuProgram(college, program) {
  return Array.isArray(SSU_PROGRAMS[college]) && SSU_PROGRAMS[college].includes(program);
}
