// solutions.js - Data module containing NPTEL solutions structured by weeks
// Global window object to ensure access across content script files

window.nptelSolutions = {
  week1: {
    "name=125": "# Example Python Solution for Week 1\ndef solution():\n    pass\n"
  },
  week2: {},
  week3: {},
  week4: {},
  week5: {
    "progassignmentId=683": `arr = [int(x) for x in input().split()]
freq = {}
for num in arr:
    freq[num] = freq.get(num, 0) + 1
max_freq = max(freq.values())
candidates = [num for num, count in freq.items() if count == max_freq]
print(min(candidates), end='')`,

    "progassignmentId=684": `arr = [int(x) for x in input().split()]
seen = set()
added = set()
result = []
for num in arr:
    if num in seen:
        if num not in added:
            result.append(num)
            added.add(num)
    else:
        seen.add(num)
if not result:
    print(-1, end='')
else:
    print(*result, end='')`,

    "progassignmentId=685": `arr = [int(x) for x in input().split()]
freq = {}
for num in arr:
    freq[num] = freq.get(num, 0) + 1
exactly_two = [num for num, count in freq.items() if count == 2]
exactly_two.sort()
if not exactly_two:
    print(-1, end='')
else:
    print(*exactly_two, end='')`
  },
  week6: {},
  week7: {},
  week8: {},
  week9: {},
  week10: {},
  week11: {},
  week12: {}
};

window.nptelMCQSolutions = {
  "assessmentId=682": {
    Q1: "5",
    Q2: "It executes only when a category is not present in borrow_count.",
    Q3: "12",
    Q4: "max_books",
    Q5: [
      'The values of "Science" and "History" are increased.',
      'The value of "Technology" remains unchanged.',
      'Exactly one new key is added to the dictionary.'
    ],
    Q6: "It stores which move defeats another move.",
    Q7: '{"Player A": 3, "Player B": 1}',
    Q8: "The move defeated by Player A's current move.",
    Q9: "Player A Wins",
    Q10: [
      'The dictionary score is updated during program execution.',
      'The program records one drawn round.',
      'The statement score["Player A"] += 1 updates the value associated with the key "Player A".'
    ],
    Q11: "Because Binary Search requires the data to be sorted.",
    Q12: "Linear Search: 4 and Binary Search: 4",
    Q13: "3",
    Q14: "The Linear Search continues checking the remaining elements even after finding the target.",
    Q15: [
      'Linear Search checks elements one by one from the beginning of the list.',
      'Binary Search repeatedly divides the search space into two halves.',
      'Both Linear Search and Binary Search return index 4 for the given input.'
    ],
    Q16: "6",
    Q17: "117",
    Q18: "[121, 126, 130, 135, 140]",
    Q19: "It eliminates half of the remaining search space after each comparison.",
    Q20: [
      'Binary Search requires the list to be sorted.',
      'Linear Search can be used on both sorted and unsorted lists.',
      'Both Linear Search and Binary Search will locate Gate 126 in this scenario.'
    ]
  }
};
