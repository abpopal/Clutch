const scoutPipelineTable = document.querySelector("#scout-pipeline-table");

const pipelineRows = [
  { athlete: "Jordan Lee", offerType: "Scholarship Inquiry", status: "Pending", deadline: "Mar 14" },
  { athlete: "Ari Kim", offerType: "Tryout Invite", status: "Accepted", deadline: "Mar 10" },
  { athlete: "Miles Carter", offerType: "Interest Flag", status: "Declined", deadline: "Mar 07" },
  { athlete: "Riley Stone", offerType: "Scholarship Inquiry", status: "Pending", deadline: "Mar 22" },
];

function renderPipeline() {
  if (!scoutPipelineTable) return;
  scoutPipelineTable.innerHTML = "";

  pipelineRows.forEach((row) => {
    const item = document.createElement("div");
    item.className = "row";

    const athlete = document.createElement("strong");
    athlete.textContent = row.athlete;

    const offerType = document.createElement("span");
    offerType.textContent = row.offerType;

    const status = document.createElement("span");
    status.textContent = row.status;

    const deadline = document.createElement("span");
    deadline.textContent = row.deadline;

    item.append(athlete, offerType, status, deadline);
    scoutPipelineTable.appendChild(item);
  });
}

window.addEventListener("session-ready", () => {
  renderPipeline();
});
